import type { PaperOrder } from "../../desktop/src/paperBroker";
import type { EquitySample } from "./equityHistory";

/** Quotes a CSV field only when it actually needs it (contains a comma, quote, or newline);
 * none of this app's own values do today, but this makes the function correct regardless. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}

const TRADE_COLUMNS = [
  "id", "market", "side", "quantity", "price", "fee", "filledAt",
  "requestedQuantity", "quotedPrice", "spreadCost", "slippageCost", "marketImpactCost"
] as const;

/** ordersNewestFirst is PaperBroker.snapshot().orders as-is (already newest-first); exported
 * chronologically (oldest first) since a CSV of trade history reads more naturally in order. */
export function ordersToCsv(ordersNewestFirst: readonly PaperOrder[]): string {
  const rows = [...ordersNewestFirst].reverse().map((order) => TRADE_COLUMNS.map((column) => order[column]));
  return toCsv(TRADE_COLUMNS, rows);
}

export function equityHistoryToCsv(history: readonly EquitySample[]): string {
  const rows = history.map((sample) => [sample.timestamp, new Date(sample.timestamp).toISOString(), sample.equity]);
  return toCsv(["timestamp", "isoTime", "equity"], rows);
}
