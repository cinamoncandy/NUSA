import { createHash, timingSafeEqual } from "node:crypto";
import type { DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";

/**
 * Everything the cloud runtime bootstrap (runtime.ts) needs to start
 * `startCloudDashboardServer`, read from the process environment and validated up front.
 * Fails closed: any missing or malformed value throws before a socket is ever opened, rather
 * than falling back to a default that would silently accept the wrong thing (an unbound port,
 * an empty token that matches anything).
 */
export interface CloudRuntimeConfig {
  readonly port: number;
  readonly host?: string;
  readonly dashboardToken: string;
}

const PORT_ENV = "NUSA_CLOUD_DASHBOARD_PORT";
const HOST_ENV = "NUSA_CLOUD_DASHBOARD_HOST";
const TOKEN_ENV = "NUSA_CLOUD_DASHBOARD_TOKEN";

export function readCloudRuntimeConfig(env: NodeJS.ProcessEnv): CloudRuntimeConfig {
  const portRaw = env[PORT_ENV];
  if (portRaw === undefined || portRaw.trim().length === 0) {
    throw new Error(`${PORT_ENV} is required`);
  }
  const port = Number(portRaw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${PORT_ENV} must be an integer in [1024, 65535], got ${JSON.stringify(portRaw)}`);
  }

  const token = env[TOKEN_ENV];
  if (token === undefined || token.trim().length === 0) {
    // There is no default that accepts any token -- an unset secret must refuse to start, not
    // fall back to "accept everything" or "accept nothing silently while reporting healthy".
    throw new Error(`${TOKEN_ENV} is required -- there is no default that accepts any token`);
  }

  const host = env[HOST_ENV]?.trim();
  return Object.freeze({
    port,
    dashboardToken: token,
    ...(host ? { host } : {})
  });
}

/**
 * A single shared-secret bearer token, compared in constant time. This is deliberately the
 * minimum viable `DashboardTokenVerifier`, not a real token issuer: one operator, one token, no
 * expiry, no per-device revocation, no multi-user scoping. `apps/cloud/src/server.ts`'s own doc
 * comment already states that a real token issuer is a separate, later decision -- this exists
 * only so the runtime bootstrap has something concrete to hand `startCloudDashboardServer`
 * instead of leaving `tokenVerifier` unimplemented.
 *
 * Hashing both sides before `timingSafeEqual` avoids its requirement that the two buffers be the
 * same length -- comparing raw, unequal-length input directly would either throw or (worse) leak
 * the true secret's length through which branch runs.
 */
export function createSharedSecretTokenVerifier(sharedSecret: string): DashboardTokenVerifier {
  if (sharedSecret.trim().length === 0) throw new Error("shared secret must not be empty");
  const expectedDigest = createHash("sha256").update(sharedSecret, "utf8").digest();
  const principal: DashboardPrincipal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });
  return Object.freeze({
    verify(token: string): DashboardPrincipal | undefined {
      if (typeof token !== "string" || token.length === 0) return undefined;
      const actualDigest = createHash("sha256").update(token, "utf8").digest();
      return timingSafeEqual(actualDigest, expectedDigest) ? principal : undefined;
    }
  });
}
