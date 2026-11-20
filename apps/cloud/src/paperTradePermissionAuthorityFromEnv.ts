import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { NO_PAPER_TRADE_PERMISSION_AUTHORITY, type PaperTradePermissionAuthority } from "./paperTradePermissionGuard";
import { PaperTradePermissionStoreReader } from "./paperTradePermissionStore";
import type { TradePermissionPolicy } from "./tradePermissionEngine";

/**
 * Production composition of the canonical permit authority (design work item c,
 * docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md).
 *
 * DEFAULT OFF. Without `NUSA_PERMIT_POLICY_FILE` the result is exactly `NO_PAPER_TRADE_PERMISSION_AUTHORITY`, so no
 * strategy order is ever created, as before. With it, the reviewed policy file is read once and the durable permit store
 * is opened READ ONLY (this module never imports the store writer and creates no table). Any problem (unreadable or
 * malformed file, missing store file, failed open) falls back to the no-permit authority and says why in `status`; it
 * never relaxes anything. A store that exists but holds no permit also yields no permit, so every order is still refused.
 * Nothing here produces a permit, changes a threshold or switches orders on.
 */

export const PERMIT_POLICY_FILE_ENV = "NUSA_PERMIT_POLICY_FILE";

export type PaperTradePermissionAuthorityStatus = "OFF" | "STORE_READ_ONLY" | "FALLBACK_NO_PERMIT";

export interface ResolvedPaperTradePermissionAuthority {
  readonly authority: PaperTradePermissionAuthority;
  readonly status: PaperTradePermissionAuthorityStatus;
  readonly reason: string;
  readonly close: () => void;
}

const POLICY_NUMBER_KEYS = [
  "minimumDataQuality", "maximumAgeMs", "minimumCalibratedProbability", "minimumNetExpectedValue", "minimumRewardToRisk", "minimumLiquidityScore",
  "minimumCapacityUsd", "maximumSlippageBps", "maximumUncertainty", "maximumModelDispersion", "maximumRiskBudgetUsage", "permissionTtlMs"
] as const;

const fallback = (reason: string): ResolvedPaperTradePermissionAuthority => ({ authority: NO_PAPER_TRADE_PERMISSION_AUTHORITY, status: "FALLBACK_NO_PERMIT", reason, close: () => undefined });

/** Strict shape check of the reviewed policy file; the engine validates ranges again on every evaluation. */
export function parsePermitPolicyFile(text: string): { readonly policy: TradePermissionPolicy; readonly probabilityModelVersion: string } {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const policyRaw = raw.policy as Record<string, unknown> | undefined;
  if (policyRaw == null || typeof policyRaw !== "object") throw new Error("policy object is required");
  if (typeof raw.probabilityModelVersion !== "string" || raw.probabilityModelVersion.trim() === "") throw new Error("probabilityModelVersion is required");
  if (typeof policyRaw.policyVersion !== "string" || policyRaw.policyVersion.trim() === "") throw new Error("policyVersion is required");
  for (const key of POLICY_NUMBER_KEYS) {
    if (typeof policyRaw[key] !== "number" || !Number.isFinite(policyRaw[key] as number)) throw new Error(`${key} must be a finite number`);
  }
  const regimes = policyRaw.compatibleRegimes;
  if (!Array.isArray(regimes) || regimes.length === 0 || regimes.some((regime) => typeof regime !== "string" || regime === "")) throw new Error("compatibleRegimes must be a non-empty string list");
  const policy = Object.freeze({ ...(policyRaw as unknown as TradePermissionPolicy), compatibleRegimes: Object.freeze([...(regimes as string[])]) });
  return { policy, probabilityModelVersion: raw.probabilityModelVersion };
}

export function resolvePaperTradePermissionAuthority(env: NodeJS.ProcessEnv, stateDbPath: string | undefined): ResolvedPaperTradePermissionAuthority {
  const policyFile = env[PERMIT_POLICY_FILE_ENV];
  if (policyFile == null || policyFile.trim() === "") return { authority: NO_PAPER_TRADE_PERMISSION_AUTHORITY, status: "OFF", reason: "NO_POLICY_FILE_CONFIGURED", close: () => undefined };
  if (stateDbPath == null || stateDbPath.trim() === "") return fallback("STATE_DB_PATH_MISSING");
  let parsed: ReturnType<typeof parsePermitPolicyFile>;
  try {
    parsed = parsePermitPolicyFile(readFileSync(policyFile, "utf8"));
  } catch {
    return fallback("POLICY_FILE_INVALID");
  }
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(stateDbPath, { readOnly: true });
  } catch {
    return fallback("STORE_OPEN_FAILED");
  }
  const authority = new PaperTradePermissionStoreReader(database, { policy: parsed.policy, probabilityModelVersion: parsed.probabilityModelVersion });
  return { authority, status: "STORE_READ_ONLY", reason: "POLICY_FILE_AND_READ_ONLY_STORE", close: () => { try { database.close(); } catch { /* already closed */ } } };
}
