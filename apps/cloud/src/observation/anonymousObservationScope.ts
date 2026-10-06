import { randomUUID } from "node:crypto";
import type { DashboardPrincipal } from "../mobileDashboardHttp";

export const ANONYMOUS_OBSERVATION_ROUTES: readonly string[] = Object.freeze([
  "/api/dashboard",
  "/api/paper-operations",
  "/api/shadow-operations",
  "/api/live-readiness",
  "/api/engineering-operations",
  "/api/evolution-learning"
]);

const FORBIDDEN_PREFIXES: readonly string[] = Object.freeze(["/api/operator/", "/v1/mobile/", "/v1/desktop/"]);
const FORBIDDEN_ROUTES: readonly string[] = Object.freeze([
  "/api/real-readonly-operations",
  "/api/paper-orders",
  "/api/settings/investment-allocation",
  "/api/ux-telemetry",
  "/api/operator/users"
]);

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
  readonly sentinel: string;
  readonly principal: DashboardPrincipal;
}

export function createAnonymousObservationScope(): AnonymousObservationScope {
  return Object.freeze({
    sentinel: `anonymous-observation:${randomUUID()}`,
    principal: Object.freeze({
      userId: "anonymous-observer",
      scopes: Object.freeze(["dashboard:read"])
    })
  });
}

export function hasBearerToken(headers: Readonly<Record<string, string | undefined>>): boolean {
  const value = headers.authorization ?? headers.Authorization;
  return typeof value === "string" && /^Bearer\s+[^\s]+$/i.test(value.trim());
}
