import { createHash, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
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
  readonly upbitMarkets: readonly string[];
  readonly upbitPublicDataEnabled: boolean;
  readonly cloudStateDbPath: string;
}

const PORT_ENV = "NUSA_CLOUD_DASHBOARD_PORT";
const HOST_ENV = "NUSA_CLOUD_DASHBOARD_HOST";
const TOKEN_ENV = "NUSA_CLOUD_DASHBOARD_TOKEN";
const MARKETS_ENV = "NUSA_CLOUD_UPBIT_MARKETS";
const PUBLIC_DATA_ENV = "NUSA_CLOUD_UPBIT_PUBLIC_DATA";
const STATE_DB_ENV = "NUSA_CLOUD_STATE_DB_PATH";
export const DEFAULT_CLOUD_UPBIT_MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH"]);
export const DEFAULT_CLOUD_STATE_DB_PATH = path.join(os.homedir(), ".nusa", "cloud", "state.sqlite");

function readMarkets(raw: string | undefined): readonly string[] {
  const values = (raw === undefined ? DEFAULT_CLOUD_UPBIT_MARKETS : raw.split(","))
    .map((value) => value.trim().toUpperCase()).filter(Boolean);
  const markets = [...new Set(values)];
  if (markets.length === 0 || markets.length > 5 || markets.some((market) => !/^KRW-[A-Z0-9-]+$/.test(market))) {
    throw new Error(`${MARKETS_ENV} must contain 1-5 KRW markets`);
  }
  return Object.freeze(markets);
}

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
    upbitMarkets: readMarkets(env[MARKETS_ENV]),
    upbitPublicDataEnabled: env[PUBLIC_DATA_ENV]?.trim().toLowerCase() === "true",
    cloudStateDbPath: env[STATE_DB_ENV]?.trim() || DEFAULT_CLOUD_STATE_DB_PATH,
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
