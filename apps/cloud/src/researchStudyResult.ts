import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResearchLedgerEntry } from "../../../packages/contracts/src/researchMetaLearning";

/**
 * Autonomous Research handoff (WO-LOOP-20261014-STUDY-RESULT-HANDOFF): the pre-registered ORDERBOOK study (scripts/run-orderbook-study.js)
 * runs in the host Research service and writes its final HOLDOUT_* result next to the state DB. The runtime meta-learner reads it here
 * as one more ledger entry, so the next recommendation and the runtime steering follow the result without anyone recording it by hand.
 * Fail closed: anything malformed, unknown or without a dataset fingerprint is ignored.
 */
export const ORDERBOOK_STUDY_RESULT_FILE = "orderbook-study-result.json";
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function parseOrderBookStudyResult(raw: unknown): ResearchLedgerEntry | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1 || r.studyId !== "ML_ORDERBOOK_60M_20261029") return undefined;
  if (r.status !== "HOLDOUT_PASS" && r.status !== "HOLDOUT_FAIL") return undefined;
  if (typeof r.datasetFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(r.datasetFingerprint)) return undefined;
  if (!nonNegativeInteger(r.eligible) || r.eligible < 4 || typeof r.discoveryPass !== "boolean") return undefined;
  return Object.freeze({
    id: "ML_ORDERBOOK_60M_20261029", source: "BACKTEST" as const, dataType: "ORDERBOOK" as const, timeframe: "60m", universe: r.eligible,
    methodClass: "ML" as const, configs: 3, discoveryPass: r.discoveryPass ? 1 : 0, holdoutPass: r.status === "HOLDOUT_PASS" ? 1 : 0,
  });
}

export function readOrderBookStudyResult(stateDbPath: string): ResearchLedgerEntry | undefined {
  try { return parseOrderBookStudyResult(JSON.parse(readFileSync(join(dirname(stateDbPath), ORDERBOOK_STUDY_RESULT_FILE), "utf8"))); } catch { return undefined; }
}
