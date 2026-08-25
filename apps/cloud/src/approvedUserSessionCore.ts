import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";
import { isUserAllowed, type NusaUserAccessRepository } from "./operatorUserAccess";

export interface ApprovedUserSessionProfile<Scope extends string> {
  readonly namespace: string;
  readonly allowedScopes: readonly Scope[];
  readonly accessTtlMs: number;
  readonly refreshTtlMs: number;
  readonly bootstrapTtlMs: number;
}

export interface ApprovedUserSessionTokens<Scope extends string> {
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  readonly scopes: readonly Scope[];
}

export interface ApprovedUserBootstrapIssue<Scope extends string> {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly targetUserId: string;
  readonly scopes: readonly Scope[];
}

export interface ApprovedUserSessionMe<Scope extends string> {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly scopes: readonly Scope[];
}

const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const deviceDigest = (deviceId: string): string => {
  const normalized = deviceId.trim();
  if (normalized.length < 8 || normalized.length > 256 || /[\r\n]/.test(normalized)) throw new Error("device enrollment identifier is invalid");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
};
const issueOpaqueToken = (): string => randomBytes(32).toString("base64url");

function validateProfile<Scope extends string>(profile: ApprovedUserSessionProfile<Scope>): void {
  if (!/^[a-z][a-z0-9_]*$/.test(profile.namespace)) throw new Error("session namespace is invalid");
  if (profile.allowedScopes.length === 0) throw new Error("session scopes are invalid");
  if (profile.accessTtlMs <= 0 || profile.refreshTtlMs <= 0 || profile.bootstrapTtlMs <= 0) {
    throw new Error("session ttl is invalid");
  }
}

export class ApprovedUserSessionService<Scope extends string> {
  private readonly prefix: string;

  public constructor(
    private readonly db: SqliteDatabase,
    private readonly users: NusaUserAccessRepository,
    private readonly profile: ApprovedUserSessionProfile<Scope>
  ) {
    validateProfile(profile);
    this.prefix = profile.namespace;
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS ${this.prefix}_bootstrap_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        target_user_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_${this.prefix}_bootstrap_expiry ON ${this.prefix}_bootstrap_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS ${this.prefix}_session_families (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoke_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_${this.prefix}_session_user ON ${this.prefix}_session_families(user_id, revoked_at, expires_at);
      CREATE TABLE IF NOT EXISTS ${this.prefix}_access_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.prefix}_access_expiry ON ${this.prefix}_access_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS ${this.prefix}_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_${this.prefix}_refresh_family ON ${this.prefix}_refresh_tokens(family_id, generation DESC);
      CREATE TABLE IF NOT EXISTS ${this.prefix}_session_audit (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor_user_id TEXT,
        target_user_id TEXT,
        family_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.prefix}_session_audit_created ON ${this.prefix}_session_audit(created_at DESC);
    `);
    try { this.db.connection.exec(`ALTER TABLE ${this.prefix}_bootstrap_tokens ADD COLUMN device_id_hash TEXT`); } catch { /* existing schema already migrated */ }
    try { this.db.connection.exec(`ALTER TABLE ${this.prefix}_session_families ADD COLUMN device_id_hash TEXT`); } catch { /* existing schema already migrated */ }
  }

  public issueBootstrap(input: Readonly<{ actorUserId: string; targetUserId: string; scopes?: readonly string[]; now?: number }>): ApprovedUserBootstrapIssue<Scope> {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor)) throw new Error("owner authority required");
    const target = this.users.get(input.targetUserId.trim());
    if (!isUserAllowed(target)) throw new Error("target user must be ACTIVE");
    return this.issueBootstrapForActiveUser(actor!.id, target!.id, input.scopes, now, "BOOTSTRAP_ISSUED");
  }

  /**
   * Issues a single-use bootstrap token to the already authenticated user.
   * This is intentionally separate from operator issuance: self-enrollment
   * never grants users:manage and can only target the caller's active account.
   */
  public issueSelfBootstrap(input: Readonly<{ actorUserId: string; deviceId: string; scopes?: readonly string[]; now?: number }>): ApprovedUserBootstrapIssue<Scope> {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (!isUserAllowed(actor)) throw new Error("target user must be ACTIVE");
    return this.issueBootstrapForActiveUser(actor!.id, actor!.id, input.scopes, now, "SELF_BOOTSTRAP_ISSUED", deviceDigest(input.deviceId));
  }

  private issueBootstrapForActiveUser(actorUserId: string, targetUserId: string, requestedScopes: readonly string[] | undefined, now: number, auditEvent: string, deviceIdHash?: string): ApprovedUserBootstrapIssue<Scope> {
    const target = this.users.get(targetUserId);
    if (!isUserAllowed(target)) throw new Error("target user must be ACTIVE");
    const scopes = this.normalizeScopes(requestedScopes);
    const id = randomUUID();
    const token = issueOpaqueToken();
    const expiresAt = now + this.profile.bootstrapTtlMs;
    this.db.transaction(() => {
      this.db.connection.prepare(`INSERT INTO ${this.prefix}_bootstrap_tokens(id,token_hash,target_user_id,scopes_json,created_by_user_id,created_at,expires_at,device_id_hash) VALUES(?,?,?,?,?,?,?,?)`)
        .run(id, tokenHash(token), target!.id, JSON.stringify(scopes), actorUserId, now, expiresAt, deviceIdHash ?? null);
      this.audit(auditEvent, actorUserId, target!.id, undefined, undefined, now);
    });
    return Object.freeze({ id, token, expiresAt, targetUserId: target!.id, scopes });
  }

  public revokeBootstrap(input: Readonly<{ actorUserId: string; bootstrapId: string; now?: number }>): boolean {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor)) throw new Error("owner authority required");
    const row = this.db.connection.prepare(`SELECT target_user_id, used_at, revoked_at FROM ${this.prefix}_bootstrap_tokens WHERE id=?`).get(input.bootstrapId) as Record<string, unknown> | undefined;
    if (row == null || row.used_at != null || row.revoked_at != null) return false;
    this.db.transaction(() => {
      this.db.connection.prepare(`UPDATE ${this.prefix}_bootstrap_tokens SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL`).run(now, input.bootstrapId);
      this.audit("BOOTSTRAP_REVOKED", actor.id, String(row.target_user_id), undefined, undefined, now);
    });
    return true;
  }

  public bootstrap(token: string, now = Date.now(), deviceId?: string): ApprovedUserSessionTokens<Scope> | undefined {
    if (!token) {
      this.audit("BOOTSTRAP_REJECTED", undefined, undefined, undefined, "EMPTY_TOKEN", now);
      return undefined;
    }
    const hash = tokenHash(token);
    const row = this.db.connection.prepare(`SELECT * FROM ${this.prefix}_bootstrap_tokens WHERE token_hash=?`).get(hash) as Record<string, unknown> | undefined;
    if (row == null) {
      this.audit("BOOTSTRAP_REJECTED", undefined, undefined, undefined, "UNKNOWN_TOKEN", now);
      return undefined;
    }
    const targetUserId = String(row.target_user_id);
    const requestedDeviceHash = row.device_id_hash == null ? undefined : deviceDigest(deviceId ?? "");
    if (row.device_id_hash != null && requestedDeviceHash !== String(row.device_id_hash)) {
      this.audit("BOOTSTRAP_REJECTED", undefined, targetUserId, undefined, "DEVICE_MISMATCH", now);
      return undefined;
    }
    if (row.used_at != null) {
      this.audit("BOOTSTRAP_REJECTED", undefined, targetUserId, undefined, "ALREADY_CONSUMED", now);
      return undefined;
    }
    if (row.revoked_at != null) {
      this.audit("BOOTSTRAP_REJECTED", undefined, targetUserId, undefined, "REVOKED", now);
      return undefined;
    }
    if (Number(row.expires_at) <= now) {
      this.audit("BOOTSTRAP_REJECTED", undefined, targetUserId, undefined, "EXPIRED", now);
      return undefined;
    }
    const user = this.users.get(targetUserId);
    if (!isUserAllowed(user)) {
      this.audit("BOOTSTRAP_REJECTED", undefined, targetUserId, undefined, "USER_NOT_ACTIVE", now);
      return undefined;
    }
    const scopes = this.decodeScopes(row.scopes_json);
    const familyId = randomUUID();
    const refreshExpiresAt = now + this.profile.refreshTtlMs;
    const tokens = this.createTokens(scopes, now, refreshExpiresAt);
    this.db.transaction(() => {
      const consumed = this.db.connection.prepare(`UPDATE ${this.prefix}_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`).run(now, hash, now);
      if (Number(consumed.changes) !== 1) throw new Error("bootstrap token already consumed");
      this.db.connection.prepare(`INSERT INTO ${this.prefix}_session_families(id,user_id,scopes_json,created_at,expires_at,device_id_hash) VALUES(?,?,?,?,?,?)`)
        .run(familyId, user!.id, JSON.stringify(scopes), now, refreshExpiresAt, row.device_id_hash == null ? null : String(row.device_id_hash));
      this.persistTokens(tokens, familyId, 0, now);
      this.audit("BOOTSTRAP_CONSUMED", user!.id, user!.id, familyId, undefined, now);
      try { this.users.markLogin(user!.id, now); } catch { throw new Error("user login state unavailable"); }
    });
    return tokens;
  }

  public refresh(refreshToken: string, now = Date.now(), deviceId?: string): ApprovedUserSessionTokens<Scope> | undefined {
    if (!refreshToken) {
      this.audit("SESSION_REFRESH_REJECTED", undefined, undefined, undefined, "EMPTY_TOKEN", now);
      return undefined;
    }
    const hash = tokenHash(refreshToken);
    const row = this.db.connection.prepare(`SELECT r.*, f.user_id, f.scopes_json, f.expires_at AS family_expires_at, f.revoked_at AS family_revoked_at
      FROM ${this.prefix}_refresh_tokens r JOIN ${this.prefix}_session_families f ON f.id=r.family_id WHERE r.token_hash=?`).get(hash) as Record<string, unknown> | undefined;
    if (row == null) {
      this.audit("SESSION_REFRESH_REJECTED", undefined, undefined, undefined, "UNKNOWN_TOKEN", now);
      return undefined;
    }
    const familyId = String(row.family_id);
    const userId = String(row.user_id);
    if (row.device_id_hash != null && deviceDigest(deviceId ?? "") !== String(row.device_id_hash)) {
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "DEVICE_MISMATCH", now);
      return undefined;
    }
    if (row.consumed_at != null) {
      this.revokeFamily(familyId, "REFRESH_REUSE_DETECTED", now);
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "REFRESH_REUSE_DETECTED", now);
      return undefined;
    }
    if (row.family_revoked_at != null) {
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "FAMILY_REVOKED", now);
      return undefined;
    }
    if (Number(row.expires_at) <= now) {
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "TOKEN_EXPIRED", now);
      return undefined;
    }
    if (Number(row.family_expires_at) <= now) {
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "FAMILY_EXPIRED", now);
      return undefined;
    }
    const user = this.users.get(userId);
    if (!isUserAllowed(user)) {
      this.revokeFamily(familyId, "USER_NOT_ACTIVE", now);
      this.audit("SESSION_REFRESH_REJECTED", userId, userId, familyId, "USER_NOT_ACTIVE", now);
      return undefined;
    }
    const scopes = this.decodeScopes(row.scopes_json);
    const familyExpiresAt = Number(row.family_expires_at);
    const generation = Number(row.generation) + 1;
    const tokens = this.createTokens(scopes, now, familyExpiresAt);
    this.db.transaction(() => {
      const consumed = this.db.connection.prepare(`UPDATE ${this.prefix}_refresh_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL`).run(now, hash);
      if (Number(consumed.changes) !== 1) throw new Error("refresh token already consumed");
      this.persistTokens(tokens, familyId, generation, now);
      this.audit("SESSION_REFRESHED", user!.id, user!.id, familyId, undefined, now);
      try { this.users.markSeen(user!.id, now); } catch { throw new Error("user state unavailable"); }
    });
    return tokens;
  }

  public verifyAccess(accessToken: string, now = Date.now()): DashboardPrincipal | undefined {
    if (!accessToken) return undefined;
    const row = this.db.connection.prepare(`SELECT f.user_id, f.scopes_json, f.expires_at AS family_expires_at, f.revoked_at, a.expires_at
      FROM ${this.prefix}_access_tokens a JOIN ${this.prefix}_session_families f ON f.id=a.family_id WHERE a.token_hash=?`).get(tokenHash(accessToken)) as Record<string, unknown> | undefined;
    if (row == null || row.revoked_at != null || Number(row.expires_at) <= now || Number(row.family_expires_at) <= now) return undefined;
    const user = this.users.get(String(row.user_id));
    if (!isUserAllowed(user)) return undefined;
    const scopes = this.decodeScopes(row.scopes_json);
    return Object.freeze({ userId: user!.id, email: user!.email, ...(user!.displayName ? { displayName: user!.displayName } : {}), scopes });
  }

  public me(accessToken: string, now = Date.now()): ApprovedUserSessionMe<Scope> | undefined {
    const principal = this.verifyAccess(accessToken, now);
    if (principal == null || principal.email == null) return undefined;
    return Object.freeze({ userId: principal.userId, email: principal.email, ...(principal.displayName ? { displayName: principal.displayName } : {}), scopes: this.normalizeScopes(principal.scopes) });
  }

  public revokeAccess(accessToken: string, now = Date.now()): boolean {
    if (!accessToken) return false;
    const row = this.db.connection.prepare(`SELECT family_id FROM ${this.prefix}_access_tokens WHERE token_hash=?`).get(tokenHash(accessToken)) as Record<string, unknown> | undefined;
    if (row == null) return false;
    return this.revokeFamily(String(row.family_id), "CLIENT_REVOKED", now);
  }

  public tokenVerifier(): DashboardTokenVerifier {
    return Object.freeze({ verify: (token: string) => this.verifyAccess(token) });
  }

  private normalizeScopes(scopes: readonly string[] | undefined): readonly Scope[] {
    const requested = scopes ?? this.profile.allowedScopes;
    const unique = [...new Set(requested.map((scope) => scope.trim()).filter(Boolean))];
    if (unique.length === 0 || unique.some((scope) => !this.profile.allowedScopes.includes(scope as Scope))) {
      throw new Error("session scopes are invalid");
    }
    return Object.freeze(unique as Scope[]);
  }

  private decodeScopes(raw: unknown): readonly Scope[] {
    if (typeof raw !== "string") throw new Error("session scopes are invalid");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("session scopes are invalid"); }
    if (!Array.isArray(parsed) || parsed.some((scope) => typeof scope !== "string")) throw new Error("session scopes are invalid");
    return this.normalizeScopes(parsed as string[]);
  }

  private createTokens(scopes: readonly Scope[], now: number, refreshExpiresAt: number): ApprovedUserSessionTokens<Scope> {
    return Object.freeze({
      accessToken: issueOpaqueToken(),
      accessExpiresAt: now + this.profile.accessTtlMs,
      refreshToken: issueOpaqueToken(),
      refreshExpiresAt,
      scopes
    });
  }

  private persistTokens(tokens: ApprovedUserSessionTokens<Scope>, familyId: string, generation: number, now: number): void {
    this.db.connection.prepare(`INSERT INTO ${this.prefix}_access_tokens(token_hash,family_id,created_at,expires_at) VALUES(?,?,?,?)`)
      .run(tokenHash(tokens.accessToken), familyId, now, tokens.accessExpiresAt);
    this.db.connection.prepare(`INSERT INTO ${this.prefix}_refresh_tokens(token_hash,family_id,generation,created_at,expires_at) VALUES(?,?,?,?,?)`)
      .run(tokenHash(tokens.refreshToken), familyId, generation, now, tokens.refreshExpiresAt);
  }

  private revokeFamily(familyId: string, reason: string, now: number): boolean {
    const row = this.db.connection.prepare(`SELECT user_id, revoked_at FROM ${this.prefix}_session_families WHERE id=?`).get(familyId) as Record<string, unknown> | undefined;
    if (row == null) return false;
    if (row.revoked_at == null) {
      this.db.transaction(() => {
        this.db.connection.prepare(`UPDATE ${this.prefix}_session_families SET revoked_at=?, revoke_reason=? WHERE id=? AND revoked_at IS NULL`).run(now, reason, familyId);
        this.audit("SESSION_REVOKED", String(row.user_id), String(row.user_id), familyId, reason, now);
      });
    }
    return true;
  }

  private audit(event: string, actorUserId: string | undefined, targetUserId: string | undefined, familyId: string | undefined, reason: string | undefined, now: number): void {
    this.db.connection.prepare(`INSERT INTO ${this.prefix}_session_audit(id,event,actor_user_id,target_user_id,family_id,reason,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(randomUUID(), event, actorUserId ?? null, targetUserId ?? null, familyId ?? null, reason ?? null, now);
  }
}

export function composeDashboardTokenVerifiers(primary: DashboardTokenVerifier, secondary: DashboardTokenVerifier): DashboardTokenVerifier {
  return Object.freeze({
    ...(primary.ownerPrincipal == null ? {} : { ownerPrincipal: primary.ownerPrincipal }),
    verify(token: string): DashboardPrincipal | undefined {
      return secondary.verify(token) ?? primary.verify(token);
    }
  });
}
