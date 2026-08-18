import type { SqliteDatabase } from "../../../packages/storage/src/index";
import type { NusaUserAccessRepository } from "./operatorUserAccess";
import {
  ApprovedUserSessionService,
  composeDashboardTokenVerifiers,
  type ApprovedUserBootstrapIssue,
  type ApprovedUserSessionMe,
  type ApprovedUserSessionTokens
} from "./approvedUserSessionCore";

export const DESKTOP_ACCESS_TTL_MS = 10 * 60 * 1000;
export const DESKTOP_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DESKTOP_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
export const DESKTOP_ALLOWED_SCOPES = Object.freeze(["dashboard:read", "paper:trade"] as const);

export type DesktopScope = (typeof DESKTOP_ALLOWED_SCOPES)[number];
export type DesktopSessionTokens = ApprovedUserSessionTokens<DesktopScope>;
export type DesktopBootstrapIssue = ApprovedUserBootstrapIssue<DesktopScope>;
export type DesktopSessionMe = ApprovedUserSessionMe<DesktopScope>;

const DESKTOP_SESSION_PROFILE = Object.freeze({
  namespace: "desktop",
  allowedScopes: DESKTOP_ALLOWED_SCOPES,
  accessTtlMs: DESKTOP_ACCESS_TTL_MS,
  refreshTtlMs: DESKTOP_REFRESH_TTL_MS,
  bootstrapTtlMs: DESKTOP_BOOTSTRAP_TTL_MS
});

export class DesktopSessionService extends ApprovedUserSessionService<DesktopScope> {
  public constructor(db: SqliteDatabase, users: NusaUserAccessRepository) {
    super(db, users, DESKTOP_SESSION_PROFILE);
  }
}

export { composeDashboardTokenVerifiers };
