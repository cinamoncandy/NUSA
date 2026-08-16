import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";
import type { SqliteDatabase } from "../../../packages/storage/src/index";

export const MOBILE_SESSION_AUDIENCE = "nusa-mobile" as const;
export const MOBILE_SESSION_SCOPES = Object.freeze([
  "paper:read",
  "paper:simulate",
  "portfolio:read",
  "history:read",
  "ai:read",
  "broker:read"
] as const);
export type MobileSessionScope = typeof MOBILE_SESSION_SCOPES[number];

export type MobileAuthErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "BOOTSTRAP_DENIED"
  | "INVALID_ARGUMENT";

export class MobileAuthError extends Error {
  public constructor(public readonly code: MobileAuthErrorCode) {
    super(code);
    this.name = "MobileAuthError";
  }
}

export interface MobileEnrollmentRecord {
  readonly proofHash: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly expiresAtMs: number;
  readonly deviceIdHash?: string;
}

export interface MobileEnrollmentSeed {
  readonly proof: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly expiresAtMs: number;
  readonly deviceId?: string;
}

export interface MobileEnrollmentRepository {
  consume(proof: string, deviceId: string, nowMs: number): MobileEnrollmentRecord | undefined;
}

export interface MobileSessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly deviceIdHash: string;
  readonly accessDigest: string;
  readonly refreshDigest: string;
  readonly issuedAtMs: number;
  readonly accessExpiresAtMs: number;
  readonly refreshExpiresAtMs: number;
  readonly revokedAtMs?: number;
  readonly audience: typeof MOBILE_SESSION_AUDIENCE;
  readonly scopes: readonly MobileSessionScope[];
}

export interface MobileSessionRepository {
  save(record: MobileSessionRecord): void;
  replace(record: MobileSessionRecord, previous?: MobileSessionRecord): void;
  findByAccessDigest(digest: string): MobileSessionRecord | undefined;
  findByRefreshDigest(digest: string): MobileSessionRecord | undefined;
  revoke(sessionId: string, revokedAtMs: number): void;
}

export interface MobileSessionIssue {
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiresAtMs: number;
  readonly refreshExpiresAtMs: number;
  readonly audience: typeof MOBILE_SESSION_AUDIENCE;
  readonly scopes: readonly MobileSessionScope[];
}

export interface MobileSessionAuthorityOptions {
  readonly accessLifetimeMs?: number;
  readonly refreshLifetimeMs?: number;
  readonly now?: () => number;
}

const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/i.test(value);
const sameDigest = (left: string, right: string): boolean => {
  if (!validHash(left) || !validHash(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};
const normalizeText = (value: string, field: string): string => {
  const normalized = value.trim();
  void field;
  if (!normalized) throw new MobileAuthError("INVALID_ARGUMENT");
  return normalized;
};
const normalizeTime = (value: number, field: string): number => {
  void field;
  if (!Number.isSafeInteger(value) || value < 0) throw new MobileAuthError("INVALID_ARGUMENT");
  return value;
};
const deviceDigest = (deviceId: string): string => digest(normalizeText(deviceId, "deviceId"));

export function createMobileEnrollmentRecord(seed: MobileEnrollmentSeed): MobileEnrollmentRecord {
  const proof = normalizeText(seed.proof, "proof");
  const userId = normalizeText(seed.userId, "userId");
  const email = normalizeText(seed.email, "email").toLowerCase();
  const expiresAtMs = normalizeTime(seed.expiresAtMs, "expiresAtMs");
  if (!email.includes("@")) throw new MobileAuthError("INVALID_ARGUMENT");
  return Object.freeze({
    proofHash: digest(proof),
    userId,
    email,
    ...(seed.displayName?.trim() ? { displayName: seed.displayName.trim() } : {}),
    expiresAtMs,
    ...(seed.deviceId?.trim() ? { deviceIdHash: deviceDigest(seed.deviceId) } : {})
  });
}

export class InMemoryMobileEnrollmentRepository implements MobileEnrollmentRepository {
  private readonly records: Array<MobileEnrollmentRecord & { consumedAtMs?: number }>;

  public constructor(seeds: readonly (MobileEnrollmentSeed | MobileEnrollmentRecord)[]) {
    this.records = seeds.map((item) => "proof" in item ? createMobileEnrollmentRecord(item) : Object.freeze({ ...item }));
  }

  public consume(proof: string, deviceId: string, nowMs: number): MobileEnrollmentRecord | undefined {
    const proofDigest = digest(normalizeText(proof, "proof"));
    const current = this.records.find((record) => sameDigest(record.proofHash, proofDigest));
    if (current == null || current.consumedAtMs != null || current.expiresAtMs <= nowMs) return undefined;
    const requestedDeviceDigest = deviceDigest(deviceId);
    if (current.deviceIdHash != null && !sameDigest(current.deviceIdHash, requestedDeviceDigest)) return undefined;
    const index = this.records.indexOf(current);
    this.records[index] = Object.freeze({ ...current, consumedAtMs: nowMs });
    const { consumedAtMs: _consumedAtMs, ...record } = this.records[index];
    return Object.freeze(record);
  }
}

export class InMemoryMobileSessionRepository implements MobileSessionRepository {
  private readonly records = new Map<string, MobileSessionRecord>();

  public save(record: MobileSessionRecord): void { this.records.set(record.sessionId, Object.freeze({ ...record })); }
  public replace(record: MobileSessionRecord, previous?: MobileSessionRecord): void {
    if (previous != null) this.records.delete(previous.sessionId);
    this.save(record);
  }
  public findByAccessDigest(value: string): MobileSessionRecord | undefined { return [...this.records.values()].find((record) => sameDigest(record.accessDigest, value)); }
  public findByRefreshDigest(value: string): MobileSessionRecord | undefined { return [...this.records.values()].find((record) => sameDigest(record.refreshDigest, value)); }
  public revoke(sessionId: string, revokedAtMs: number): void {
    const record = this.records.get(sessionId);
    if (record != null) this.records.set(sessionId, Object.freeze({ ...record, revokedAtMs: record.revokedAtMs ?? revokedAtMs }));
  }
}

export class SqliteMobileEnrollmentRepository implements MobileEnrollmentRepository {
  public constructor(private readonly db: SqliteDatabase, records: readonly MobileEnrollmentRecord[]) {
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS mobile_enrollments (
        proof_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT,
        expires_at_ms INTEGER NOT NULL, device_id_hash TEXT, consumed_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_enrollments_expiry ON mobile_enrollments(expires_at_ms, consumed_at_ms);
    `);
    for (const record of records) {
      if (!validHash(record.proofHash)) throw new MobileAuthError("INVALID_ARGUMENT");
      db.connection.prepare("INSERT OR IGNORE INTO mobile_enrollments(proof_hash,user_id,email,display_name,expires_at_ms,device_id_hash) VALUES(?,?,?,?,?,?)").run(record.proofHash, record.userId, record.email, record.displayName ?? null, record.expiresAtMs, record.deviceIdHash ?? null);
    }
  }

  public consume(proof: string, deviceId: string, nowMs: number): MobileEnrollmentRecord | undefined {
    const proofHash = digest(normalizeText(proof, "proof"));
    const requestedDeviceHash = deviceDigest(deviceId);
    let result: MobileEnrollmentRecord | undefined;
    this.db.transaction(() => {
      const row = this.db.connection.prepare("SELECT * FROM mobile_enrollments WHERE proof_hash=? AND consumed_at_ms IS NULL").get(proofHash) as Record<string, unknown> | undefined;
      if (row == null || Number(row.expires_at_ms) <= nowMs || (row.device_id_hash != null && !sameDigest(String(row.device_id_hash), requestedDeviceHash))) return;
      this.db.connection.prepare("UPDATE mobile_enrollments SET consumed_at_ms=? WHERE proof_hash=? AND consumed_at_ms IS NULL").run(nowMs, proofHash);
      result = Object.freeze({ proofHash, userId: String(row.user_id), email: String(row.email), ...(row.display_name == null ? {} : { displayName: String(row.display_name) }), expiresAtMs: Number(row.expires_at_ms), ...(row.device_id_hash == null ? {} : { deviceIdHash: String(row.device_id_hash) }) });
    });
    return result;
  }
}

export class SqliteMobileSessionRepository implements MobileSessionRepository {
  public constructor(private readonly db: SqliteDatabase) {
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS mobile_sessions (
        session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT,
        device_id_hash TEXT NOT NULL, access_digest TEXT NOT NULL UNIQUE, refresh_digest TEXT NOT NULL UNIQUE,
        issued_at_ms INTEGER NOT NULL, access_expires_at_ms INTEGER NOT NULL, refresh_expires_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER, audience TEXT NOT NULL, scopes_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_sessions_access ON mobile_sessions(access_digest);
      CREATE INDEX IF NOT EXISTS idx_mobile_sessions_refresh ON mobile_sessions(refresh_digest);
    `);
  }

  public save(record: MobileSessionRecord): void {
    this.db.connection.prepare(`INSERT INTO mobile_sessions(session_id,user_id,email,display_name,device_id_hash,access_digest,refresh_digest,issued_at_ms,access_expires_at_ms,refresh_expires_at_ms,revoked_at_ms,audience,scopes_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.sessionId, record.userId, record.email, record.displayName ?? null, record.deviceIdHash, record.accessDigest, record.refreshDigest, record.issuedAtMs, record.accessExpiresAtMs, record.refreshExpiresAtMs, record.revokedAtMs ?? null, record.audience, JSON.stringify(record.scopes));
  }
  public replace(record: MobileSessionRecord, previous?: MobileSessionRecord): void { this.db.transaction(() => { if (previous != null) this.db.connection.prepare("DELETE FROM mobile_sessions WHERE session_id=?").run(previous.sessionId); this.save(record); }); }
  public findByAccessDigest(value: string): MobileSessionRecord | undefined { return this.decode(this.db.connection.prepare("SELECT * FROM mobile_sessions WHERE access_digest=?").get(value) as Record<string, unknown> | undefined); }
  public findByRefreshDigest(value: string): MobileSessionRecord | undefined { return this.decode(this.db.connection.prepare("SELECT * FROM mobile_sessions WHERE refresh_digest=?").get(value) as Record<string, unknown> | undefined); }
  public revoke(sessionId: string, revokedAtMs: number): void { this.db.connection.prepare("UPDATE mobile_sessions SET revoked_at_ms=COALESCE(revoked_at_ms,?) WHERE session_id=?").run(revokedAtMs, sessionId); }
  private decode(row: Record<string, unknown> | undefined): MobileSessionRecord | undefined {
    if (row == null || String(row.audience) !== MOBILE_SESSION_AUDIENCE) return undefined;
    let scopes: unknown;
    try { scopes = JSON.parse(String(row.scopes_json)); } catch { return undefined; }
    if (!Array.isArray(scopes) || scopes.some((scope) => !MOBILE_SESSION_SCOPES.includes(scope as MobileSessionScope))) return undefined;
    return Object.freeze({ sessionId: String(row.session_id), userId: String(row.user_id), email: String(row.email), ...(row.display_name == null ? {} : { displayName: String(row.display_name) }), deviceIdHash: String(row.device_id_hash), accessDigest: String(row.access_digest), refreshDigest: String(row.refresh_digest), issuedAtMs: Number(row.issued_at_ms), accessExpiresAtMs: Number(row.access_expires_at_ms), refreshExpiresAtMs: Number(row.refresh_expires_at_ms), ...(row.revoked_at_ms == null ? {} : { revokedAtMs: Number(row.revoked_at_ms) }), audience: MOBILE_SESSION_AUDIENCE, scopes: Object.freeze(scopes as MobileSessionScope[]) });
  }
}

const token = (): string => randomBytes(32).toString("base64url");

export class MobileSessionAuthority {
  private readonly accessLifetimeMs: number;
  private readonly refreshLifetimeMs: number;
  private readonly now: () => number;

  public constructor(
    private readonly enrollments: MobileEnrollmentRepository,
    private readonly sessions: MobileSessionRepository,
    options: MobileSessionAuthorityOptions = {}
  ) {
    this.accessLifetimeMs = options.accessLifetimeMs ?? 15 * 60 * 1000;
    this.refreshLifetimeMs = options.refreshLifetimeMs ?? 7 * 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.accessLifetimeMs) || this.accessLifetimeMs <= 0 || !Number.isSafeInteger(this.refreshLifetimeMs) || this.refreshLifetimeMs <= this.accessLifetimeMs) throw new MobileAuthError("INVALID_ARGUMENT");
  }

  public bootstrap(input: Readonly<{ proof: string; deviceId: string }>): MobileSessionIssue {
    const nowMs = normalizeTime(this.now(), "nowMs");
    const proof = normalizeText(input.proof, "proof");
    const deviceId = normalizeText(input.deviceId, "deviceId");
    const enrollment = this.enrollments.consume(proof, deviceId, nowMs);
    if (enrollment == null) throw new MobileAuthError("BOOTSTRAP_DENIED");
    return this.issue(enrollment, deviceId, nowMs);
  }

  public refresh(refreshToken: string): MobileSessionIssue {
    const value = normalizeText(refreshToken, "refreshToken");
    const nowMs = normalizeTime(this.now(), "nowMs");
    const current = this.sessions.findByRefreshDigest(digest(value));
    if (current == null || current.audience !== MOBILE_SESSION_AUDIENCE) throw new MobileAuthError("AUTH_REQUIRED");
    if (current.revokedAtMs != null) throw new MobileAuthError("SESSION_REVOKED");
    if (current.refreshExpiresAtMs <= nowMs) throw new MobileAuthError("SESSION_EXPIRED");
    return this.issue({ proofHash: "", userId: current.userId, email: current.email, ...(current.displayName ? { displayName: current.displayName } : {}), expiresAtMs: current.refreshExpiresAtMs, deviceIdHash: current.deviceIdHash }, current.deviceIdHash, nowMs, current);
  }

  public revokeAccess(accessToken: string): void {
    const value = normalizeText(accessToken, "accessToken");
    const record = this.sessions.findByAccessDigest(digest(value));
    if (record == null) throw new MobileAuthError("AUTH_REQUIRED");
    this.sessions.revoke(record.sessionId, this.now());
  }

  public verifyAccess(accessToken: string): DashboardPrincipal | undefined {
    if (!accessToken.trim()) return undefined;
    const record = this.sessions.findByAccessDigest(digest(accessToken));
    if (record == null || record.audience !== MOBILE_SESSION_AUDIENCE || record.revokedAtMs != null || record.accessExpiresAtMs <= this.now()) return undefined;
    return Object.freeze({ userId: record.userId, email: record.email, ...(record.displayName ? { displayName: record.displayName } : {}), scopes: Object.freeze([...record.scopes]), authDomain: "MOBILE" as const, sessionId: record.sessionId });
  }

  public tokenVerifier(): DashboardTokenVerifier {
    return Object.freeze({ verify: (value: string) => this.verifyAccess(value) });
  }

  private issue(identity: MobileEnrollmentRecord, deviceId: string, nowMs: number, previous?: MobileSessionRecord): MobileSessionIssue {
    const accessToken = token();
    const refreshToken = token();
    const record: MobileSessionRecord = Object.freeze({
      sessionId: previous?.sessionId ?? randomUUID(),
      userId: identity.userId,
      email: identity.email,
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      deviceIdHash: previous?.deviceIdHash ?? deviceDigest(deviceId),
      accessDigest: digest(accessToken),
      refreshDigest: digest(refreshToken),
      issuedAtMs: nowMs,
      accessExpiresAtMs: nowMs + this.accessLifetimeMs,
      refreshExpiresAtMs: previous?.refreshExpiresAtMs ?? nowMs + this.refreshLifetimeMs,
      audience: MOBILE_SESSION_AUDIENCE,
      scopes: MOBILE_SESSION_SCOPES
    });
    this.sessions.replace(record, previous);
    return Object.freeze({ tokenType: "Bearer", accessToken, refreshToken, sessionId: record.sessionId, expiresAtMs: record.accessExpiresAtMs, refreshExpiresAtMs: record.refreshExpiresAtMs, audience: record.audience, scopes: record.scopes });
  }
}
