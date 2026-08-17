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
  readonly paperInvestmentPercent: number;
  readonly ownerId: string;
}

interface ConfiguredUserIdentity {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
}

const PORT_ENV = "NUSA_CLOUD_DASHBOARD_PORT";
const HOST_ENV = "NUSA_CLOUD_DASHBOARD_HOST";
const TOKEN_ENV = "NUSA_CLOUD_DASHBOARD_TOKEN";
const USER_IDENTITIES_ENV = "NUSA_CLOUD_USER_IDENTITIES_JSON";
const OWNER_ID_ENV = "NUSA_OWNER_ID";
const OWNER_EMAIL_ENV = "NUSA_OWNER_EMAIL";
const OWNER_NAME_ENV = "NUSA_OWNER_DISPLAY_NAME";
const MARKETS_ENV = "NUSA_CLOUD_UPBIT_MARKETS";
const PUBLIC_DATA_ENV = "NUSA_CLOUD_UPBIT_PUBLIC_DATA";
const STATE_DB_ENV = "NUSA_CLOUD_STATE_DB_PATH";
const PAPER_INITIAL_CAPITAL_ENV = "NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW";
const PAPER_INVESTMENT_PERCENT_ENV = "NUSA_CLOUD_PAPER_INVESTMENT_PERCENT";
export const DEFAULT_CLOUD_UPBIT_MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH"]);
export const DEFAULT_CLOUD_STATE_DB_PATH = path.join(os.homedir(), ".nusa", "cloud", "state.sqlite");

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const cleanName = (value: string | undefined): string | undefined => value?.trim() || undefined;

function readMarkets(raw: string | undefined): readonly string[] {
  const values = (raw === undefined ? DEFAULT_CLOUD_UPBIT_MARKETS : raw.split(","))
    .map((value) => value.trim().toUpperCase()).filter(Boolean);
  const markets = [...new Set(values)];
  if (markets.length === 0 || markets.length > 5 || markets.some((market) => !/^KRW-[A-Z0-9-]+$/.test(market))) {
    throw new Error(`${MARKETS_ENV} must contain 1-5 KRW markets`);
  }
  return Object.freeze(markets);
}

function resolveOwnerIdentity(sharedSecret: string, env: NodeJS.ProcessEnv): DashboardPrincipal {
  const fallbackId = `owner-${createHash("sha256").update(sharedSecret, "utf8").digest("hex").slice(0, 16)}`;
  const userId = env[OWNER_ID_ENV]?.trim() || fallbackId;
  const email = normalizeEmail(env[OWNER_EMAIL_ENV]?.trim() || `${fallbackId}@nusa.local`);
  const displayName = cleanName(env[OWNER_NAME_ENV]) ?? "NUSA Owner";
  if (!userId || !email.includes("@")) throw new Error("owner identity is invalid");
  return Object.freeze({
    userId,
    email,
    displayName,
    scopes: Object.freeze(["dashboard:read", "paper:trade", "settings:read", "settings:write", "users:manage"])
  });
}

function readConfiguredUsers(sharedSecret: string, env: NodeJS.ProcessEnv, owner: DashboardPrincipal): readonly ConfiguredUserIdentity[] {
  const raw = env[USER_IDENTITIES_ENV]?.trim();
  if (!raw) return Object.freeze([]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${USER_IDENTITIES_ENV} must be valid JSON`); }
  if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error(`${USER_IDENTITIES_ENV} must be an array with at most 1000 users`);

  const seenTokens = new Set<string>([createHash("sha256").update(sharedSecret, "utf8").digest("hex")]);
  const seenIds = new Set<string>([owner.userId]);
  const seenEmails = new Set<string>(owner.email ? [normalizeEmail(owner.email)] : []);
  const users: ConfiguredUserIdentity[] = [];

  for (const item of parsed) {
    if (item == null || typeof item !== "object") throw new Error(`${USER_IDENTITIES_ENV} contains an invalid user`);
    const value = item as Record<string, unknown>;
    const token = typeof value.token === "string" ? value.token.trim() : "";
    const userId = typeof value.userId === "string" ? value.userId.trim() : "";
    const email = typeof value.email === "string" ? normalizeEmail(value.email) : "";
    const displayName = typeof value.displayName === "string" ? cleanName(value.displayName) : undefined;
    if (Buffer.byteLength(token, "utf8") < 32) throw new Error(`${USER_IDENTITIES_ENV} user token must contain at least 32 UTF-8 bytes`);
    if (!userId || !email.includes("@")) throw new Error(`${USER_IDENTITIES_ENV} user identity is invalid`);
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    if (seenTokens.has(tokenHash) || seenIds.has(userId) || seenEmails.has(email)) throw new Error(`${USER_IDENTITIES_ENV} contains duplicate token or identity`);
    seenTokens.add(tokenHash); seenIds.add(userId); seenEmails.add(email);
    users.push(Object.freeze({ token, userId, email, ...(displayName ? { displayName } : {}) }));
  }
  return Object.freeze(users);
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
  const paperInvestmentPercentRaw = env[PAPER_INVESTMENT_PERCENT_ENV]?.trim();
  const paperInvestmentPercent = paperInvestmentPercentRaw === undefined || paperInvestmentPercentRaw === "" ? 100 : Number(paperInvestmentPercentRaw);
  if (!Number.isFinite(paperInvestmentPercent) || paperInvestmentPercent < 0 || paperInvestmentPercent > 100) throw new Error(`${PAPER_INVESTMENT_PERCENT_ENV} must be between 0 and 100`);
  const owner = resolveOwnerIdentity(token, env);
  readConfiguredUsers(token, env, owner);
  return Object.freeze({ port, dashboardToken: token, upbitMarkets: readMarkets(env[MARKETS_ENV]), upbitPublicDataEnabled: env[PUBLIC_DATA_ENV]?.trim().toLowerCase() === "true", paperInvestmentPercent, ownerId: owner.userId, cloudStateDbPath: env[STATE_DB_ENV]?.trim() || DEFAULT_CLOUD_STATE_DB_PATH, ...(paperInitialCapitalKrw === undefined ? {} : { paperInitialCapitalKrw }), ...(host ? { host } : {}) });
}

/**
 * The owner bearer and each configured user bearer resolve to stable identity metadata.
 * `paper:trade` is PAPER-only application authority. Only the owner receives
 * `users:manage`. No principal receives LIVE execution, transfer, withdrawal, or
 * production-mutation authority from this verifier.
 */
export function createSharedSecretTokenVerifier(sharedSecret: string, env: NodeJS.ProcessEnv = process.env): DashboardTokenVerifier {
  if (Buffer.byteLength(sharedSecret, "utf8") < 32) throw new Error("shared secret must contain at least 32 UTF-8 bytes");
  const ownerPrincipal = resolveOwnerIdentity(sharedSecret, env);
  const ownerDigest = digest(sharedSecret);
  const users = readConfiguredUsers(sharedSecret, env, ownerPrincipal).map((user) => Object.freeze({
    digest: digest(user.token),
    principal: Object.freeze({
      userId: user.userId,
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
      scopes: Object.freeze(["dashboard:read", "paper:trade", "settings:read", "settings:write"])
    }) satisfies DashboardPrincipal
  }));

  return Object.freeze({
    ownerPrincipal,
    verify(token: string): DashboardPrincipal | undefined {
      if (typeof token !== "string" || token.length === 0) return undefined;
      const actualDigest = digest(token);
      if (timingSafeEqual(actualDigest, ownerDigest)) return ownerPrincipal;
      for (const entry of users) if (timingSafeEqual(actualDigest, entry.digest)) return entry.principal;
      return undefined;
    }
  });
}
