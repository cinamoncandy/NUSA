import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { isUserAllowed, type NusaUserAccessRepository } from "./operatorUserAccess";
import { hashOwnerPassword, verifyOwnerPassword } from "./ownerCredential/ownerPassword";
import {
  mayAttempt,
  recordFailure,
  recordSuccess,
  type AttemptRecord
} from "./ownerCredential/ownerPasswordThrottle";
import {
  ApprovedUserSessionService,
  type ApprovedUserBootstrapIssue,
  type ApprovedUserSessionMe,
  type ApprovedUserSessionTokens
} from "./approvedUserSessionCore";

export const MOBILE_ACCESS_TTL_MS = 10 * 60 * 1000;
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MOBILE_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
export const MOBILE_ALLOWED_SCOPES = Object.freeze(["dashboard:read", "paper:trade"] as const);

export type MobileScope = (typeof MOBILE_ALLOWED_SCOPES)[number];
export type MobileSessionTokens = ApprovedUserSessionTokens<MobileScope>;
export type MobileBootstrapIssue = ApprovedUserBootstrapIssue<MobileScope>;
export type MobileSessionMe = ApprovedUserSessionMe<MobileScope>;
export const MOBILE_PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_PAIRINGS = 100;
const MAX_ACTIVE_PAIRINGS_PER_DEVICE = 1;
export type MobilePairingState = "PENDING" | "APPROVED" | "CONSUMED" | "EXPIRED";
export type OwnerPasswordSignIn =
  | { readonly status: "ISSUED"; readonly tokens: MobileSessionTokens }
  | { readonly status: "REJECTED" }
  | { readonly status: "LOCKED"; readonly retryAfterMs: number };

const MOBILE_SESSION_PROFILE = Object.freeze({
  namespace: "mobile",
  allowedScopes: MOBILE_ALLOWED_SCOPES,
  accessTtlMs: MOBILE_ACCESS_TTL_MS,
  refreshTtlMs: MOBILE_REFRESH_TTL_MS,
  bootstrapTtlMs: MOBILE_BOOTSTRAP_TTL_MS
});

const CLIENT_REVOKED_RECOVERY_ISSUED_BEFORE = Date.parse("2026-09-08T00:00:00.000Z");
const CLIENT_REVOKED_RECOVERY_EXPIRES_AT = Date.parse("2026-09-15T00:00:00.000Z");
const CLIENT_REVOKED_RECOVERY_MAX_DELAY_MS = 2 * 60 * 1000;
const hashToken = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export class MobileSessionService extends ApprovedUserSessionService<MobileScope> {
  public constructor(private readonly mobileDb: SqliteDatabase, private readonly mobileUsers: NusaUserAccessRepository) {
    super(mobileDb, mobileUsers, MOBILE_SESSION_PROFILE);
    this.mobileDb.connection.exec(`
      CREATE TABLE IF NOT EXISTS mobile_pairing_requests (
        request_id_hash TEXT PRIMARY KEY,
        verification_code_hash TEXT NOT NULL,
        device_id_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('PENDING','APPROVED','CONSUMED','EXPIRED')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        approved_at INTEGER,
        approved_by_user_id TEXT,
        target_user_id TEXT,
        consumed_at INTEGER
      );
    `);
    this.mobileDb.connection.exec(`
      CREATE TABLE IF NOT EXISTS nusa_owner_password (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        last_failure_at INTEGER
      );
    `);
    this.mobileDb.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_mobile_pairing_expiry ON mobile_pairing_requests(expires_at);
      CREATE INDEX IF NOT EXISTS idx_mobile_pairing_device ON mobile_pairing_requests(device_id_hash,state,expires_at);
    `);
  }

  public override bootstrap(token: string, now = Date.now(), deviceId?: string): MobileSessionTokens | undefined {
    const ordinary = super.bootstrap(token, now, deviceId);
    if (ordinary != null || !token || now > CLIENT_REVOKED_RECOVERY_EXPIRES_AT) return ordinary;
    const tokenHash = hashToken(token);
    const row = this.mobileDb.connection.prepare("SELECT * FROM mobile_bootstrap_tokens WHERE token_hash=?").get(tokenHash) as Record<string, unknown> | undefined;
    if (row == null || row.used_at == null || row.revoked_at != null || Number(row.created_at) >= CLIENT_REVOKED_RECOVERY_ISSUED_BEFORE) return undefined;
    const userId = String(row.target_user_id ?? "");
    if (!userId || String(row.created_by_user_id ?? "") !== userId) return undefined;
    const user = this.mobileUsers.get(userId);
    if (user?.role !== "OWNER" || !isUserAllowed(user)) return undefined;
    const usedAt = Number(row.used_at);
    if (!Number.isSafeInteger(usedAt) || usedAt <= 0) return undefined;
    const family = this.mobileDb.connection.prepare(`SELECT id,created_at,revoked_at,revoke_reason,device_id_hash FROM mobile_session_families
      WHERE user_id=? AND created_at BETWEEN ? AND ? AND revoke_reason='CLIENT_REVOKED'
      ORDER BY ABS(created_at-?) ASC LIMIT 1`).get(userId, usedAt - 1_000, usedAt + 1_000, usedAt) as Record<string, unknown> | undefined;
    if (family == null || family.revoked_at == null) return undefined;
    const familyCreatedAt = Number(family.created_at);
    const familyRevokedAt = Number(family.revoked_at);
    if (!Number.isSafeInteger(familyCreatedAt) || !Number.isSafeInteger(familyRevokedAt) || familyRevokedAt < familyCreatedAt || familyRevokedAt - familyCreatedAt > CLIENT_REVOKED_RECOVERY_MAX_DELAY_MS) return undefined;
    const rowDevice = row.device_id_hash == null ? null : String(row.device_id_hash);
    const familyDevice = family.device_id_hash == null ? null : String(family.device_id_hash);
    if (rowDevice !== familyDevice) return undefined;

    // Re-open only this proven historical bootstrap. The ordinary atomic consume below still
    // arbitrates concurrent attempts. A successful migration immediately retires the old secret.
    const reopened = this.mobileDb.connection.prepare("UPDATE mobile_bootstrap_tokens SET used_at=NULL WHERE token_hash=? AND used_at=? AND revoked_at IS NULL").run(tokenHash, usedAt);
    if (Number(reopened.changes) !== 1) return undefined;
    const recovered = super.bootstrap(token, now, deviceId);
    if (recovered == null) {
      this.mobileDb.connection.prepare("UPDATE mobile_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL").run(usedAt, tokenHash);
      return undefined;
    }
    this.mobileDb.transaction(() => {
      this.mobileDb.connection.prepare("UPDATE mobile_bootstrap_tokens SET revoked_at=? WHERE token_hash=? AND used_at=? AND revoked_at IS NULL").run(now, tokenHash, now);
      this.mobileDb.connection.prepare("INSERT INTO mobile_session_audit(id,event,actor_user_id,target_user_id,family_id,reason,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(), "BOOTSTRAP_RECOVERED_AFTER_CLIENT_REVOKE", userId, userId, null, "HISTORICAL_CLIENT_BUG_MIGRATION", now);
    });
    return recovered;
  }

  public startPairing(deviceId: string, now = Date.now()): Readonly<{ requestId: string; verificationCode: string; expiresAt: number; state: "PENDING" }> {
    const deviceHash = hashToken(this.validateDeviceId(deviceId));
    const requestId = randomBytes(32).toString("base64url");
    const verificationCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = now + MOBILE_PAIRING_TTL_MS;
    return this.mobileDb.transaction(() => {
      this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='EXPIRED' WHERE expires_at<=? AND state IN ('PENDING','APPROVED')").run(now);
      const superseded = this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='EXPIRED',expires_at=? WHERE device_id_hash=? AND state IN ('PENDING','APPROVED') AND expires_at>?")
        .run(now, deviceHash, now);
      const active = Number((this.mobileDb.connection.prepare("SELECT COUNT(*) AS count FROM mobile_pairing_requests WHERE state IN ('PENDING','APPROVED') AND expires_at>?").get(now) as Record<string, unknown>).count);
      const deviceActive = Number((this.mobileDb.connection.prepare("SELECT COUNT(*) AS count FROM mobile_pairing_requests WHERE device_id_hash=? AND state IN ('PENDING','APPROVED') AND expires_at>?").get(deviceHash, now) as Record<string, unknown>).count);
      if (deviceActive >= MAX_ACTIVE_PAIRINGS_PER_DEVICE) throw new Error("pairing request limit reached");
      // The global cap bounds the table, but refusing on it hands an unauthenticated caller a
      // lockout. /v1/mobile/pairing/start takes no credential and deviceId is self-chosen --
      // installationIdentity.ts generates it locally -- so one caller inventing
      // MAX_ACTIVE_PAIRINGS device ids refuses the owner's real phone for the whole TTL, and can
      // hold it there indefinitely. Ordinary reinstall churn does the same thing more slowly, and
      // what it locks out is the only way onto the account. Evicting the oldest PENDING request
      // keeps the bound and keeps the newest request -- the one a human is looking at right now.
      // APPROVED requests are never evicted: an owner already acted on them and they are seconds
      // from being consumed.
      if (active >= MAX_ACTIVE_PAIRINGS) {
        const evicted = this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='EXPIRED' WHERE request_id_hash IN (SELECT request_id_hash FROM mobile_pairing_requests WHERE state='PENDING' AND expires_at>? ORDER BY created_at ASC LIMIT ?)")
          .run(now, active - MAX_ACTIVE_PAIRINGS + 1);
        if (Number(evicted.changes) === 0) throw new Error("pairing request limit reached");
      }
      this.mobileDb.connection.prepare("INSERT INTO mobile_pairing_requests(request_id_hash,verification_code_hash,device_id_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,?)")
        .run(hashToken(requestId), hashToken(verificationCode), deviceHash, "PENDING", now, expiresAt);
      if (Number(superseded.changes) > 0) this.auditPairing("PAIRING_SUPERSEDED", undefined, undefined, "SAME_DEVICE_RETRY", now);
      this.auditPairing("PAIRING_STARTED", undefined, undefined, "PENDING", now);
      return Object.freeze({ requestId, verificationCode, expiresAt, state: "PENDING" as const });
    });
  }

  public pairingStatus(requestId: string, deviceId: string, now = Date.now()): Readonly<{ state: MobilePairingState; expiresAt: number }> | undefined {
    this.expirePairings(now);
    const row = this.pairingRow(requestId, deviceId);
    if (row == null) return undefined;
    return Object.freeze({ state: String(row.state) as MobilePairingState, expiresAt: Number(row.expires_at) });
  }

  public approvePairing(input: Readonly<{ actorUserId: string; actorScopes: readonly string[]; targetUserId: string; requestId?: string; verificationCode: string; now?: number }>): boolean {
    const now = input.now ?? Date.now();
    this.expirePairings(now);
    const actor = this.mobileUsers.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor) || !input.actorScopes.includes("users:manage")) throw new Error("owner authority required");
    const requestId = input.requestId?.trim() ?? "";
    const row = requestId
      ? this.mobileDb.connection.prepare("SELECT * FROM mobile_pairing_requests WHERE request_id_hash=?").get(hashToken(requestId)) as Record<string, unknown> | undefined
      : this.mobileDb.connection.prepare("SELECT * FROM mobile_pairing_requests WHERE verification_code_hash=? AND state='PENDING' AND expires_at>? LIMIT 2").all(hashToken(input.verificationCode.trim()), now) as Record<string, unknown>[];
    const selected = Array.isArray(row) ? (row.length === 1 ? row[0] : undefined) : row;
    if (selected == null || selected.state !== "PENDING" || Number(selected.expires_at) <= now || hashToken(input.verificationCode.trim()) !== selected.verification_code_hash) return false;
    const target = this.mobileUsers.get(input.targetUserId.trim());
    if (!isUserAllowed(target)) throw new Error("target user must be ACTIVE");
    this.mobileDb.transaction(() => {
      const updated = this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='APPROVED',approved_at=?,approved_by_user_id=?,target_user_id=? WHERE request_id_hash=? AND state='PENDING' AND expires_at>?")
        .run(now, actor.id, target!.id, String(selected.request_id_hash), now);
      if (Number(updated.changes) !== 1) throw new Error("pairing approval race");
      this.auditPairing("PAIRING_APPROVED", actor.id, target!.id, "APPROVED", now);
    });
    return true;
  }

  public exchangePairing(requestId: string, deviceId: string, now = Date.now()): MobileSessionTokens | undefined {
    this.expirePairings(now);
    const row = this.pairingRow(requestId, deviceId);
    if (row == null || row.state !== "APPROVED" || Number(row.expires_at) <= now || typeof row.target_user_id !== "string") return undefined;
    return this.mobileDb.transaction(() => {
      const updated = this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='CONSUMED',consumed_at=? WHERE request_id_hash=? AND device_id_hash=? AND state='APPROVED' AND expires_at>?")
        .run(now, hashToken(requestId), hashToken(this.validateDeviceId(deviceId)), now);
      if (Number(updated.changes) !== 1) return undefined;
      const tokens = this.createDeviceBoundSession({ targetUserId: String(row.target_user_id), deviceId: this.validateDeviceId(deviceId), now, auditEvent: "PAIRING_SESSION_ISSUED" });
      this.auditPairing("PAIRING_CONSUMED", String(row.approved_by_user_id ?? ""), String(row.target_user_id), "CONSUMED", now);
      return tokens;
    });
  }

  /**
   * Signs in with the owner's password and issues a device-bound rotating session.
   *
   * This is the credential a person can carry in their head, so it is the one an attacker can
   * reach from the open internet. Order matters here: the throttle is consulted before the
   * password is, so a locked account costs an attacker a refusal rather than a scrypt derivation,
   * and a wrong password costs the same work whether or not the account has a password at all.
   *
   * Not configured is reported as rejected. Telling an unauthenticated caller "no password is set
   * here" hands them the one moment the server is easiest to claim; the owner learns it from
   * `/health`, which answers a question about the deployment rather than about an account.
   */
  public signInWithOwnerPassword(input: Readonly<{
    userId: string;
    password: unknown;
    deviceId: string;
    now?: number;
  }>): OwnerPasswordSignIn {
    const now = input.now ?? Date.now();
    const userId = input.userId.trim();
    const deviceId = this.validateDeviceId(input.deviceId);
    const record = this.attemptRecord(userId);
    const decision = mayAttempt(record, now);
    if (!decision.allowed) return Object.freeze({ status: "LOCKED", retryAfterMs: decision.retryAfterMs });

    const stored = this.storedPasswordHash(userId);
    const outcome = verifyOwnerPassword(stored, input.password);
    if (outcome.status !== "ACCEPTED") {
      this.writeAttempt(userId, recordFailure(record, now));
      return Object.freeze({ status: "REJECTED" });
    }

    const user = this.mobileUsers.get(userId);
    // A correct password on a suspended or unregistered account is still not a way in. Checked
    // after verification so the answer does not depend on which of the two failed.
    if (user == null || !isUserAllowed(user) || user.role !== "OWNER") {
      this.writeAttempt(userId, recordFailure(record, now));
      return Object.freeze({ status: "REJECTED" });
    }

    return this.mobileDb.transaction(() => {
      this.writeAttempt(userId, recordSuccess());
      // Raising the cost policy must not lock the owner out, so the hash is replaced on the next
      // successful sign-in rather than at deploy time.
      if (outcome.needsRehash && typeof input.password === "string") {
        this.mobileDb.connection.prepare("UPDATE nusa_owner_password SET password_hash=?,updated_at=? WHERE user_id=?")
          .run(hashOwnerPassword(input.password), now, userId);
      }
      const tokens = this.createDeviceBoundSession({ targetUserId: user.id, deviceId, now, auditEvent: "OWNER_PASSWORD_SESSION_ISSUED" });
      return Object.freeze({ status: "ISSUED" as const, tokens });
    });
  }

  /** Sets or replaces the owner's password. Called by the one-time setup script, never over HTTP. */
  public setOwnerPassword(userId: string, password: string, now = Date.now()): void {
    const user = this.mobileUsers.get(userId.trim());
    if (user == null || user.role !== "OWNER") throw new Error("owner account required");
    const hash = hashOwnerPassword(password);
    this.mobileDb.transaction(() => {
      this.mobileDb.connection.prepare("INSERT INTO nusa_owner_password(user_id,password_hash,updated_at,failures,locked_until,last_failure_at) VALUES(?,?,?,0,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at,failures=0,locked_until=NULL,last_failure_at=NULL")
        .run(user.id, hash, now);
      this.auditPairing("OWNER_PASSWORD_SET", user.id, user.id, "OWNER_PASSWORD", now);
    });
  }

  /** Whether password sign-in is usable at all. A fact about the deployment, not about an account. */
  public ownerPasswordConfigured(): boolean {
    const row = this.mobileDb.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_password").get() as Record<string, unknown>;
    return Number(row.count) > 0;
  }

  private storedPasswordHash(userId: string): string | undefined {
    const row = this.mobileDb.connection.prepare("SELECT password_hash FROM nusa_owner_password WHERE user_id=?").get(userId) as Record<string, unknown> | undefined;
    return row == null ? undefined : String(row.password_hash);
  }

  private attemptRecord(userId: string): AttemptRecord | undefined {
    const row = this.mobileDb.connection.prepare("SELECT failures,locked_until,last_failure_at FROM nusa_owner_password WHERE user_id=?").get(userId) as Record<string, unknown> | undefined;
    if (row == null) return undefined;
    return Object.freeze({
      failures: Number(row.failures),
      lockedUntilMs: row.locked_until == null ? null : Number(row.locked_until),
      lastFailureAtMs: row.last_failure_at == null ? null : Number(row.last_failure_at)
    });
  }

  private writeAttempt(userId: string, record: AttemptRecord): void {
    this.mobileDb.connection.prepare("UPDATE nusa_owner_password SET failures=?,locked_until=?,last_failure_at=? WHERE user_id=?")
      .run(record.failures, record.lockedUntilMs, record.lastFailureAtMs, userId);
  }

  private validateDeviceId(deviceId: string): string {
    const value = deviceId.trim();
    if (value.length < 8 || value.length > 256 || /[\r\n]/.test(value)) throw new Error("device enrollment identifier is invalid");
    return value;
  }
  private pairingRow(requestId: string, deviceId: string): Record<string, unknown> | undefined {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(requestId)) return undefined;
    const deviceHash = hashToken(this.validateDeviceId(deviceId));
    return this.mobileDb.connection.prepare("SELECT * FROM mobile_pairing_requests WHERE request_id_hash=? AND device_id_hash=?").get(hashToken(requestId), deviceHash) as Record<string, unknown> | undefined;
  }
  private expirePairings(now: number): void {
    this.mobileDb.connection.prepare("UPDATE mobile_pairing_requests SET state='EXPIRED' WHERE expires_at<=? AND state IN ('PENDING','APPROVED')").run(now);
  }
  private auditPairing(event: string, actor: string | undefined, target: string | undefined, reason: string, now: number): void {
    this.mobileDb.connection.prepare("INSERT INTO mobile_session_audit(id,event,actor_user_id,target_user_id,family_id,reason,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), event, actor ?? null, target ?? null, null, reason, now);
  }

}
