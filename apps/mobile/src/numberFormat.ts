/**
 * Canonical financial number language for the mobile product (STEP-3 P2).
 *
 * Four screens formatted identical values four different ways
 * (homeView.krw, watchlistView.formatPrice, portfolioView.money,
 * orderHistoryView.money). Same economics must read the same everywhere,
 * so there is exactly one implementation per semantic:
 *
 * - formatKRW: rounded KRW with ko-KR grouping (hero/price/balance).
 * - formatSignedMoney: explicit + / - signed KRW (PnL rows).
 * - formatSignedPercent: signed ratio as percent with fixed 2 decimals.
 *   The missing-value label differs by context (hero "—" vs row "-"),
 *   so it is a parameter — never invent a number for missing data.
 *
 * Display only. Accounting precision lives in the domain layer, never here.
 * Deliberately NOT unified: chartViewModel.formatChartPrice uses the en-US
 * "KRW" convention, a different semantic owned by the chart surface; and
 * homeDecisionSurface.ts keeps its own identical copy because that module
 * is evaluated by an isolated transpile harness in tests and cannot take
 * on a module import (see mobile-home-decision-surface.test.js).
 */

export function formatKRW(value: number): string {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

export function formatSignedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatKRW(Math.abs(value))}`;
}

export function formatSignedPercent(value: number | null, missingLabel = "—"): string {
  if (value === null) return missingLabel;
  const percent = value * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}
