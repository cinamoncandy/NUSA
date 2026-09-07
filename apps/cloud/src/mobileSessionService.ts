import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { isUserAllowed, type NusaUserAccessRepository } from "./operatorUserAccess";
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
}
