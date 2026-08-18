import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";
import { isUserAllowed, type NusaUserAccessRepository } from "./operatorUserAccess";

export const DESKTOP_ACCESS_TTL_MS = 10 * 60 * 1000;
export const DESKTOP_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DESKTOP_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
export const DESKTOP_ALLOWED_SCOPES = Object.freeze(["dashboard:read", "paper:trade"] as const);

type DesktopScope = (typeof DESKTOP_ALLOWED_SCOPES)[number];

export interface DesktopSessionTokens {
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  readonly scopes: readonly DesktopScope[];
}

export interface DesktopBootstrapIssue {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly targetUserId: string;
  readonly scopes: readonly DesktopScope[];
}

export interface DesktopSessionMe {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly scopes: readonly DesktopScope[];
}

const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const issueOpaqueToken = (): string => randomBytes(32).toString("base64url");
const encodeScopes = (scopes: readonly DesktopScope[]): string => JSON.stringify(scopes);

function normalizeScopes(scopes: readonly string[] | undefined): readonly DesktopScope[] {
  const requested = scopes ?? DESKTOP_ALLOWED_SCOPES;
  const unique = [...new Set(requested.map((scope) => scope.trim()).filter(Boolean))];
  if (unique.length === 0 || unique.some((scope) => !DESKTOP_ALLOWED_SCOPES.includes(scope as DesktopScope))) {
    throw new Error("desktop session scopes are invalid");
  }
  return Object.freeze(unique as DesktopScope[]);
}

function decodeScopes(raw: unknown): readonly DesktopScope[] {
  if (typeof raw !== "string") throw new Error("desktop session scopes are invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("desktop session scopes are invalid"); }
  if (!Array.isArray(parsed) || parsed.some((scope) => typeof scope !== "string")) throw new Error("desktop session scopes are invalid");
  return normalizeScopes(parsed as string[]);
}

export class DesktopSessionService {
  public constructor(
    private readonly db: SqliteDatabase,
    private readonly users: NusaUserAccessRepository
  ) {
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS desktop_bootstrap_tokens (
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
      CREATE INDEX IF NOT EXISTS idx_desktop_bootstrap_expiry ON desktop_bootstrap_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS desktop_session_families (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoke_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_session_user ON desktop_session_families(user_id, revoked_at, expires_at);
      CREATE TABLE IF NOT EXISTS desktop_access_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_access_expiry ON desktop_access_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS desktop_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_refresh_family ON desktop_refresh_tokens(family_id, generation DESC);
      CREATE TABLE IF NOT EXISTS desktop_session_audit (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor_user_id TEXT,
        target_user_id TEXT,
        family_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_session_audit_created ON desktop_session_audit(created_at DESC);
    `);
  }

  public issueBootstrap(input: Readonly<{ actorUserId: string; targetUserId: string; scopes?: readonly string[]; now?: number }>): DesktopBootstrapIssue {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor)) throw new Error("owner authority required");
    const target = this.users.get(input.targetUserId.trim());
    if (!isUserAllowed(target)) throw new Error("target user must be ACTIVE");
    const scopes = normalizeScopes(input.scopes);
    const id = randomUUID();
    const token = issueOpaqueToken();
    const expiresAt = now + DESKTOP_BOOTSTRAP_TTL_MS;
    this.db.transaction(() => {
      this.db.connection.prepare("INSERT INTO desktop_bootstrap_tokens(id,token_hash,target_user_id,scopes_json,created_by_user_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)")
        .run(id, tokenHash(token), target!.id, encodeScopes(scopes), actor.id, now, expiresAt);
      this.audit("BOOTSTRAP_ISSUED", actor.id, target!.id, undefined, undefined, now);
    });
    return Object.freeze({ id, token, expiresAt, targetUserId: target!.id, scopes });
  }

  public revokeBootstrap(input: Readonly<{ actorUserId: string; bootstrapId: string; now?: number }>): boolean {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor)) throw new Error("owner authority required");
    const row = this.db.connection.prepare("SELECT target_user_id, used_at, revoked_at FROM desktop_bootstrap_tokens WHERE id=?").get(input.bootstrapId) as Record<string, unknown> | undefined;
    if (row == null || row.used_at != null || row.revoked_at != null) return false;
    this.db.transaction(() => {
      this.db.connection.prepare("UPDATE desktop_bootstrap_tokens SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL").run(now, input.bootstrapId);
      this.audit("BOOTSTRAP_REVOKED", actor.id, String(row.target_user_id), undefined, undefined, now);
    });
    return true;
  }

  public bootstrap(token: string, now = Date.now()): DesktopSessionTokens | undefined {
    if (!token) return undefined;
    const hash = tokenHash(token);
    const row = this.db.connection.prepare("SELECT * FROM desktop_bootstrap_tokens WHERE token_hash=?").get(hash) as Record<string, unknown> | undefined;
    if (row == null || row.used_at != null || row.revoked_at != null || Number(row.expires_at) <= now) return undefined;
    const user = this.users.get(String(row.target_user_id));
    if (!isUserAllowed(user)) return undefined;
    const scopes = decodeScopes(row.scopes_json);
    const familyId = randomUUID();
    const refreshExpiresAt = now + DESKTOP_REFRESH_TTL_MS;
    const tokens = this.createTokens(familyId, scopes, now, refreshExpiresAt, 0);
    this.db.transaction(() => {
      const consumed = this.db.connection.prepare("UPDATE desktop_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?").run(now, hash, now);
      if (Number(consumed.changes) !== 1) throw new Error("bootstrap token already consumed");
      this.db.connection.prepare("INSERT INTO desktop_session_families(id,user_id,scopes_json,created_at,expires_at) VALUES(?,?,?,?,?)")
        .run(familyId, user!.id, encodeScopes(scopes), now, refreshExpiresAt);
      this.persistTokens(tokens, familyId, 0, now);
      this.audit("BOOTSTRAP_CONSUMED", user!.id, user!.id, familyId, undefined, now);
      try { this.users.markLogin(user!.id, now); } catch { throw new Error("user login state unavailable"); }
    });
    return tokens;
  }

  public refresh(refreshToken: string, now = Date.now()): DesktopSessionTokens | undefined {
    if (!refreshToken) return undefined;
    const hash = tokenHash(refreshToken);
    const row = this.db.connection.prepare(`SELECT r.*, f.user_id, f.scopes_json, f.expires_at AS family_expires_at, f.revoked_at AS family_revoked_at
      FROM desktop_refresh_tokens r JOIN desktop_session_families f ON f.id=r.family_id WHERE r.token_hash=?`).get(hash) as Record<string, unknown> | undefined;
    if (row == null) return undefined;
    const familyId = String(row.family_id);
    if (row.consumed_at != null) {
      this.revokeFamily(familyId, "REFRESH_REUSE_DETECTED", now);
      return undefined;
    }
    if (row.family_revoked_at != null || Number(row.expires_at) <= now || Number(row.family_expires_at) <= now) return undefined;
    const user = this.users.get(String(row.user_id));
    if (!isUserAllowed(user)) {
      this.revokeFamily(familyId, "USER_NOT_ACTIVE", now);
      return undefined;
    }
    const scopes = decodeScopes(row.scopes_json);
    const familyExpiresAt = Number(row.family_expires_at);
    const generation = Number(row.generation) + 1;
    const tokens = this.createTokens(familyId, scopes, now, familyExpiresAt, generation);
    this.db.transaction(() => {
      const consumed = this.db.connection.prepare("UPDATE desktop_refresh_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL").run(now, hash);
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
      FROM desktop_access_tokens a JOIN desktop_session_families f ON f.id=a.family_id WHERE a.token_hash=?`).get(tokenHash(accessToken)) as Record<string, unknown> | undefined;
    if (row == null || row.revoked_at != null || Number(row.expires_at) <= now || Number(row.family_expires_at) <= now) return undefined;
    const user = this.users.get(String(row.user_id));
    if (!isUserAllowed(user)) return undefined;
    const scopes = decodeScopes(row.scopes_json);
    return Object.freeze({ userId: user!.id, email: user!.email, ...(user!.displayName ? { displayName: user!.displayName } : {}), scopes });
  }

  public me(accessToken: string, now = Date.now()): DesktopSessionMe | undefined {
    const principal = this.verifyAccess(accessToken, now);
    if (principal == null || principal.email == null) return undefined;
    return Object.freeze({ userId: principal.userId, email: principal.email, ...(principal.displayName ? { displayName: principal.displayName } : {}), scopes: normalizeScopes(principal.scopes) });
  }

  public revokeAccess(accessToken: string, now = Date.now()): boolean {
    if (!accessToken) return false;
    const row = this.db.connection.prepare("SELECT family_id FROM desktop_access_tokens WHERE token_hash=?").get(tokenHash(accessToken)) as Record<string, unknown> | undefined;
    if (row == null) return false;
    return this.revokeFamily(String(row.family_id), "CLIENT_REVOKED", now);
  }

  public tokenVerifier(): DashboardTokenVerifier {
    return Object.freeze({ verify: (token: string) => this.verifyAccess(token) });
  }

  private createTokens(familyId: string, scopes: readonly DesktopScope[], now: number, refreshExpiresAt: number, _generation: number): DesktopSessionTokens {
    void familyId;
    const accessToken = issueOpaqueToken();
    const refreshToken = issueOpaqueToken();
    return Object.freeze({ accessToken, accessExpiresAt: now + DESKTOP_ACCESS_TTL_MS, refreshToken, refreshExpiresAt, scopes });
  }

  private persistTokens(tokens: DesktopSessionTokens, familyId: string, generation: number, now: number): void {
    this.db.connection.prepare("INSERT INTO desktop_access_tokens(token_hash,family_id,created_at,expires_at) VALUES(?,?,?,?)")
      .run(tokenHash(tokens.accessToken), familyId, now, tokens.accessExpiresAt);
    this.db.connection.prepare("INSERT INTO desktop_refresh_tokens(token_hash,family_id,generation,created_at,expires_at) VALUES(?,?,?,?,?)")
      .run(tokenHash(tokens.refreshToken), familyId, generation, now, tokens.refreshExpiresAt);
  }

  private revokeFamily(familyId: string, reason: string, now: number): boolean {
    const row = this.db.connection.prepare("SELECT user_id, revoked_at FROM desktop_session_families WHERE id=?").get(familyId) as Record<string, unknown> | undefined;
    if (row == null) return false;
    if (row.revoked_at == null) {
      this.db.transaction(() => {
        this.db.connection.prepare("UPDATE desktop_session_families SET revoked_at=?, revoke_reason=? WHERE id=? AND revoked_at IS NULL").run(now, reason, familyId);
        this.audit("SESSION_REVOKED", String(row.user_id), String(row.user_id), familyId, reason, now);
      });
    }
    return true;
  }

  private audit(event: string, actorUserId: string | undefined, targetUserId: string | undefined, familyId: string | undefined, reason: string | undefined, now: number): void {
    this.db.connection.prepare("INSERT INTO desktop_session_audit(id,event,actor_user_id,target_user_id,family_id,reason,created_at) VALUES(?,?,?,?,?,?,?)")
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
