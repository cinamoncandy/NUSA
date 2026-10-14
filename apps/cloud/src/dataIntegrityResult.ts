import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The daily stored-data integrity probe (scripts/run-data-integrity-probe.js, host Research service) writes its result next to the
 * state DB; /health publishes it as runtime.dataIntegrity so the data state is visible without a manual diagnosis run.
 * Display only: it gates nothing. Fail closed: a missing, malformed or unknown result is omitted.
 */
export const DATA_INTEGRITY_RESULT_FILE = "data-integrity-result.json";
const FIELD = /^[a-zA-Z0-9]{1,40}$/;

export function parseDataIntegrityResult(raw: unknown): Readonly<Record<string, string | number>> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 1 || (r.status !== "PASS" && r.status !== "WARN" && r.status !== "FAIL")) return undefined;
  if (!Number.isSafeInteger(r.observedAt) || (r.observedAt as number) <= 0) return undefined;
  const out: Record<string, string | number> = { status: r.status };
  for (const [key, value] of Object.entries(r)) {
    if (key === "status" || key === "schemaVersion" || !FIELD.test(key)) continue;
    if (Number.isSafeInteger(value) && (value as number) >= 0) out[key] = value as number;
  }
  return Object.freeze(out);
}

export function readDataIntegrityResult(stateDbPath: string): Readonly<Record<string, string | number>> | undefined {
  try { return parseDataIntegrityResult(JSON.parse(readFileSync(join(dirname(stateDbPath), DATA_INTEGRITY_RESULT_FILE), "utf8"))); } catch { return undefined; }
}
