import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodeBaselineShadow, type BaselineShadowPersisted } from "./paperBaselineShadow";

/** Restart-surviving totals of the baseline shadow, beside the Cloud state (same trust level as runtime-last-failure.json). Best-effort; display only. */
export const BASELINE_SHADOW_RECORD_FILE = "paper-baseline-shadow.json";

export function baselineShadowRecordPath(cloudStateDbPath: string): string | undefined {
  const normalized = cloudStateDbPath.trim();
  if (!normalized || normalized === ":memory:" || !path.isAbsolute(normalized)) return undefined;
  return path.join(path.dirname(normalized), BASELINE_SHADOW_RECORD_FILE);
}

/** True only after the atomic rename succeeded, so a caller can retry on a later tick. */
export function writeBaselineShadowRecord(cloudStateDbPath: string, value: BaselineShadowPersisted): boolean {
  const file = baselineShadowRecordPath(cloudStateDbPath);
  if (file == null || decodeBaselineShadow(JSON.parse(JSON.stringify(value))) === undefined) return false;
  try {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

export function readBaselineShadowRecord(cloudStateDbPath: string): BaselineShadowPersisted | undefined {
  const file = baselineShadowRecordPath(cloudStateDbPath);
  if (file == null || !existsSync(file)) return undefined;
  try { return decodeBaselineShadow(JSON.parse(readFileSync(file, "utf8"))); } catch { return undefined; }
}
