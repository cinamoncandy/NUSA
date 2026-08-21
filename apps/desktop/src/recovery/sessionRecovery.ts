import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface RecoveredJson<T> { readonly state?: T; readonly diagnostic?: string; readonly restoredFromBackup: boolean; }

export function loadJsonWithBackup<T>(filePath: string, validate: (value: unknown) => T, label: string): RecoveredJson<T> {
  const read = (candidate: string): T => validate(JSON.parse(readFileSync(candidate, "utf8")) as unknown);
  try { return Object.freeze({ state: read(filePath), restoredFromBackup: false }); }
  catch (primaryError) {
    const primaryCode = (primaryError as NodeJS.ErrnoException).code;
    if (primaryCode === "ENOENT") return Object.freeze({ restoredFromBackup: false });
    const backupPath = `${filePath}.bak`;
    try {
      return Object.freeze({ state: read(backupPath), restoredFromBackup: true, diagnostic: `${label} primary is invalid; backup restored and automatic trading remains disabled` });
    } catch (backupError) {
      return Object.freeze({ restoredFromBackup: false, diagnostic: `${label} recovery failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}; backup failed: ${backupError instanceof Error ? backupError.message : String(backupError)}` });
    }
  }
}

export function writeJsonWithBackup(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (existsSync(filePath)) copyFileSync(filePath, backupPath);
  renameSync(temporaryPath, filePath);
}
