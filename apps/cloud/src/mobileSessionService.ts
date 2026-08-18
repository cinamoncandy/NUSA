import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { NusaUserAccessRepository } from "./operatorUserAccess";
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

export class MobileSessionService extends ApprovedUserSessionService<MobileScope> {
  public constructor(db: SqliteDatabase, users: NusaUserAccessRepository) {
    super(db, users, MOBILE_SESSION_PROFILE);
  }
}
