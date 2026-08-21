import type { DatabaseSync } from "node:sqlite";

/**
 * Best-effort continuity data only: the strategy's recent tick price history, so a
 * restart doesn't need to silently re-warm-up from zero. Deliberately independent
 * of save()/saveWithScenarioEvent(s) -- it carries no accounting or control-audit
 * meaning, so a failure here must never affect paperTradingAvailable or trigger the
 * fail-closed evidence path those methods use.
 */
export function saveStrategyPriceHistory(db: DatabaseSync, transaction: <T>(operation: () => T) => T, prices: readonly number[]): void {
  if (!prices.every((price) => Number.isFinite(price) && price > 0)) {
    throw new Error("strategy price history must contain only positive finite numbers");
  }
  transaction(() => {
    db.prepare("INSERT OR REPLACE INTO desktop_strategy_state (id, payload) VALUES (1, ?)").run(JSON.stringify({ version: 1, priceHistory: prices }));
  });
}

export function loadStrategyPriceHistory(db: DatabaseSync): readonly number[] | undefined {
  const row = db.prepare("SELECT payload FROM desktop_strategy_state WHERE id = 1").get() as { payload: string } | undefined;
  if (row == null) return undefined;
  const parsed = JSON.parse(row.payload) as { version?: number; priceHistory?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.priceHistory) || !parsed.priceHistory.every((price) => Number.isFinite(price) && price > 0)) {
    throw new Error("stored strategy price history is invalid");
  }
  return parsed.priceHistory as readonly number[];
}
