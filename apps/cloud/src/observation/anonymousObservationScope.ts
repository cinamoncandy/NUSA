import { randomUUID } from "node:crypto";
import type { DashboardPrincipal } from "../mobileDashboardHttp";

/**
 * Routes that may be served without a bearer token when anonymous observation is enabled.
 *
 * These are read-only projections of PAPER/learning state. They issue no credential, expose no
 * REAL exchange balance, and create no order. Every route outside this list keeps its normal
 * fail-closed authorization, so enabling anonymous observation cannot widen the control surface.
 */
export const ANONYMOUS_OBSERVATION_ROUTES: readonly string[] = Object.freeze([
  "/api/dashboard",
  "/api/paper-operations",
  "/api/shadow-operations",
  "/api/live-readiness",
  "/api/engineering-operations",
  "/api/evolution-learning"
]);

/**
 * Surfaces that must never become anonymous, and why:
 *
 * - /api/operator/*                     issues or approves session credentials. Opening the door
 *                                       that mints keys would nullify every other lock.
 * - /api/real-readonly-operations       REAL Upbit account balances. Not PAPER data.
 * - /api/paper-orders                   externally injectable orders would make the autonomous
 *                                       fill/PnL certification evidence forgeable.
 * - /api/settings/investment-allocation mutates runtime allocation.
 * - /api/ux-telemetry                   append-only write scope.
 */
const FORBIDDEN_PREFIXES: readonly string[] = Object.freeze(["/api/operator/", "/v1/mobile/", "/v1/desktop/"]);
const FORBIDDEN_ROUTES: readonly string[] = Object.freeze([
  "/api/real-readonly-operations",
  "/api/paper-orders",
  "/api/settings/investment-allocation",
  "/api/ux-telemetry",
  "/api/operator/users"
]);

// Invoked at module load, not merely declared: a future edit that adds a credential-issuing or
// mutating route to the allowlist fails the process at startup rather than silently exposing it.
for (const route of ANONYMOUS_OBSERVATION_ROUTES) {
  if (FORBIDDEN_ROUTES.includes(route) || FORBIDDEN_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    throw new Error(`anonymous observation allowlist must not contain the privileged route ${route}`);
  }
}

export function anonymousObservationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NUSA_CLOUD_ANONYMOUS_OBSERVATION ?? "").trim() === "1";
}

export function isAnonymousObservationRoute(url: string | undefined): boolean {
  return url != null && ANONYMOUS_OBSERVATION_ROUTES.includes(url);
}

export interface AnonymousObservationScope {
  /** Per-process random value. It is never persisted, logged, or returned to a client, so it
   * cannot be presented by a caller; it only marks a request the router itself elected to serve
   * anonymously on an allowlisted route. */
  readonly sentinel: string;
  readonly principal: DashboardPrincipal;
}

export function createAnonymousObservationScope(): AnonymousObservationScope {
  return Object.freeze({
    sentinel: `anonymous-observation:${randomUUID()}`,
    principal: Object.freeze({
      userId: "anonymous-observer",
      // dashboard:read only. paper:trade and telemetry:write stay structurally unreachable.
      scopes: Object.freeze(["dashboard:read"])
    })
  });
}

export function hasBearerToken(headers: Readonly<Record<string, string | undefined>>): boolean {
  const value = headers.authorization ?? headers.Authorization;
  return typeof value === "string" && /^Bearer\s+[^\s]+$/i.test(value.trim());
}
