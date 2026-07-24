import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StrategyChoice } from "./paperRuntime";

const VALID_CHOICES: readonly StrategyChoice[] = ["sma-crossover", "ema-crossover"];

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
  try {
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const choice = (parsed as { choice?: unknown }).choice;
    return typeof choice === "string" && (VALID_CHOICES as readonly string[]).includes(choice) ? (choice as StrategyChoice) : undefined;
  } catch {
    return undefined;
  }
}

export function saveStrategyChoice(path: string, choice: StrategyChoice): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ choice }), "utf8");
}
