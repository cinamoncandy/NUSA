import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StrategyChoice, StrategyPeriods } from "./paperRuntime";

const VALID_CHOICES: readonly StrategyChoice[] = ["sma-crossover", "ema-crossover"];

interface StoredStrategySettings {
  readonly choice?: unknown;
  readonly shortPeriod?: unknown;
  readonly longPeriod?: unknown;
}

function loadRaw(path: string): StoredStrategySettings {
  try {
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredStrategySettings) : {};
  } catch {
    return {};
  }
}

function saveRaw(path: string, settings: StoredStrategySettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings), "utf8");
}

/**
 * Best-effort persistence for which trading strategy (SMA/EMA) is currently selected,
 * kept deliberately separate from DesktopPersistenceStore (apps/desktop/src) rather than
 * adding a table/method there: apps/desktop's store is reused as-is by this server and is
 * not otherwise modified by this product. This is a small sidecar JSON file next to the
 * SQLite database, matching the same "best-effort continuity only, never affects
 * paperTradingAvailable" philosophy already used for strategy price-history persistence
 * (apps/desktop/src/desktopPersistenceStore.ts's saveStrategyPriceHistory) -- losing this
 * file only means the server falls back to the SMA(5, 20) default on restart, never a
 * failure of account/order/control state.
 */
export function loadStrategyChoice(path: string): StrategyChoice | undefined {
  const choice = loadRaw(path).choice;
  return typeof choice === "string" && (VALID_CHOICES as readonly string[]).includes(choice) ? (choice as StrategyChoice) : undefined;
}

/** Read-modify-write: preserves whatever period settings (see below) are already in the file. */
export function saveStrategyChoice(path: string, choice: StrategyChoice): void {
  saveRaw(path, { ...loadRaw(path), choice });
}

/**
 * Same sidecar file, same best-effort-only philosophy as the strategy choice above (losing
 * this file just falls back to the SMA/EMA classes' own (5, 20) constructor defaults, never a
 * fault of account/order/control state) -- kept in the same file rather than a second one
 * since both describe "which strategy, configured how" as a single unit.
 */
export function loadStrategyPeriods(path: string): StrategyPeriods | undefined {
  const { shortPeriod, longPeriod } = loadRaw(path);
  if (typeof shortPeriod !== "number" || typeof longPeriod !== "number") return undefined;
  if (!Number.isInteger(shortPeriod) || !Number.isInteger(longPeriod) || shortPeriod < 2 || longPeriod <= shortPeriod) return undefined;
  return { shortPeriod, longPeriod };
}

export function saveStrategyPeriods(path: string, periods: StrategyPeriods): void {
  saveRaw(path, { ...loadRaw(path), shortPeriod: periods.shortPeriod, longPeriod: periods.longPeriod });
}
