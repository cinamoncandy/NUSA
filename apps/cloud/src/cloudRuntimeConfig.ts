import { createHash, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";

export interface CloudRuntimeConfig {
  readonly port: number;
  readonly host?: string;
  readonly dashboardToken: string;
  readonly upbitMarkets: readonly string[];
  readonly upbitPublicDataEnabled: boolean;
  readonly cloudStateDbPath: string;
  readonly paperInitialCapitalKrw?: number;
}

const PORT_ENV = "NUSA_CLOUD_DASHBOARD_PORT";
const HOST_ENV = "NUSA_CLOUD_DASHBOARD_HOST";
const TOKEN_ENV = "NUSA_CLOUD_DASHBOARD_TOKEN";
const MARKETS_ENV = "NUSA_CLOUD_UPBIT_MARKETS";
const PUBLIC_DATA_ENV = "NUSA_CLOUD_UPBIT_PUBLIC_DATA";
const STATE_DB_ENV = "NUSA_CLOUD_STATE_DB_PATH";
const PAPER_INITIAL_CAPITAL_ENV = "NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW";
export const DEFAULT_CLOUD_UPBIT_MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH"]);
export const DEFAULT_CLOUD_STATE_DB_PATH = path.join(os.homedir(), ".nusa", "cloud", "state.sqlite");

function readMarkets(raw: string | undefined): readonly string[] {
  const values = (raw === undefined ? DEFAULT_CLOUD_UPBIT_MARKETS : raw.split(","))
    .map((value) => value.trim().toUpperCase()).filter(Boolean);
  const markets = [...new Set(values)];
  if (markets.length === 0 || markets.length > 5 || markets.some((market) => !/^KRW-[A-Z0-9-]+$/.test(market))) throw new Error(`${MARKETS_ENV} must contain 1-5 KRW markets`);
  return Object.freeze(markets);
}

export function readCloudRuntimeConfig(env: NodeJS.ProcessEnv): CloudRuntimeConfig {
  const portRaw = env[PORT_ENV];
  if (portRaw === undefined || portRaw.trim().length === 0) throw new Error(`${PORT_ENV} is required`);
  const port = Number(portRaw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error(`${PORT_ENV} must be an integer in [1024, 65535], got ${JSON.stringify(portRaw)}`);
  const token = env[TOKEN_ENV];
  if (token === undefined || token.trim().length === 0 || Buffer.byteLength(token, "utf8") < 32) throw new Error(`${TOKEN_ENV} is required and must contain at least 32 UTF-8 bytes`);
  const host = env[HOST_ENV]?.trim();
  if (host !== undefined && host !== "" && host !== "127.0.0.1" && host.toLowerCase() !== "localhost") throw new Error(`${HOST_ENV} must be 127.0.0.1 or localhost`);
  const paperInitialCapitalRaw = env[PAPER_INITIAL_CAPITAL_ENV]?.trim();
  const paperInitialCapitalKrw = paperInitialCapitalRaw === undefined || paperInitialCapitalRaw === "" ? undefined : Number(paperInitialCapitalRaw);
  if (paperInitialCapitalKrw !== undefined && (!Number.isFinite(paperInitialCapitalKrw) || paperInitialCapitalKrw <= 0)) throw new Error(`${PAPER_INITIAL_CAPITAL_ENV} must be a positive number when provided`);
  return Object.freeze({ port, dashboardToken: token, upbitMarkets: readMarkets(env[MARKETS_ENV]), upbitPublicDataEnabled: env[PUBLIC_DATA_ENV]?.trim().toLowerCase() === "true", cloudStateDbPath: env[STATE_DB_ENV]?.trim() || DEFAULT_CLOUD_STATE_DB_PATH, ...(paperInitialCapitalKrw === undefined ? {} : { paperInitialCapitalKrw }), ...(host ? { host } : {}) });
}

/**
 * One personal operator secret. `paper:trade` is intentionally PAPER-only application authority;
 * settings scopes only permit changing the PAPER cash allocation envelope. None of these scopes imply
 * broker credentials, LIVE execution, transfer, withdrawal, or production mutation.
 */
export function createSharedSecretTokenVerifier(sharedSecret: string): DashboardTokenVerifier {
  if (Buffer.byteLength(sharedSecret, "utf8") < 32) throw new Error("shared secret must contain at least 32 UTF-8 bytes");
  const expectedDigest = createHash("sha256").update(sharedSecret, "utf8").digest();
  const principal: DashboardPrincipal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read", "paper:trade", "settings:read", "settings:write"]) });
  return Object.freeze({
    verify(token: string): DashboardPrincipal | undefined {
      if (typeof token !== "string" || token.length === 0) return undefined;
      const actualDigest = createHash("sha256").update(token, "utf8").digest();
      return timingSafeEqual(actualDigest, expectedDigest) ? principal : undefined;
    }
  });
}
