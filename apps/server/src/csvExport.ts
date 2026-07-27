import type { PaperOrder } from "../../desktop/src/paperBroker";
import type { ControlEvent } from "../../desktop/src/controlPlane";
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

const EVENT_COLUMNS = ["id", "timestamp", "type", "message"] as const;

/**
 * eventsNewestFirst is ControlPlane.snapshot().events as-is (record() unshifts, see
 * controlPlane.ts) -- exported chronologically (oldest first), same convention as
 * ordersToCsv(). type/message stay the raw English ControlPlane recorded (not the Korean
 * apiRouter.ts's /api/control applies for display -- translateEventType/translateLogMessage
 * are a display concern, same reasoning as ordersToCsv() keeping side as raw "BUY"/"SELL"
 * rather than 매수/매도). The optional `data` field is a per-event-type arbitrary shape (a
 * fill report, a signal, ...) with no single flat CSV representation, so it's omitted here,
 * same as TRADE_COLUMNS already omits nothing but isn't asked to represent nested data either.
 */
export function eventsToCsv(eventsNewestFirst: readonly ControlEvent[]): string {
  const rows = [...eventsNewestFirst].reverse().map((event) => EVENT_COLUMNS.map((column) => event[column]));
  return toCsv(EVENT_COLUMNS, rows);
}

/**
 * Each challenger records an equity sample on the exact same tick (championSystem.ts's
 * onCandleUpdate loops over all challengers with one shared timestamp per call), so their
 * histories are always the same length with aligned timestamps -- safe to zip into one wide
 * CSV (one equity column per challenger) rather than needing a per-challenger join by nearest
 * timestamp. Falls back to an empty header-only CSV if no challenger has ticked yet.
 */
export function championEquityHistoryToCsv(challengers: readonly { readonly id: string; readonly label: string; readonly history: readonly EquitySample[] }[]): string {
  const header = ["timestamp", "isoTime", ...challengers.map((c) => c.label)];
  const sampleCount = challengers[0]?.history.length ?? 0;
  const rows = Array.from({ length: sampleCount }, (_, i) => {
    const timestamp = challengers[0]!.history[i]!.timestamp;
    return [timestamp, new Date(timestamp).toISOString(), ...challengers.map((c) => c.history[i]?.equity ?? "")];
  });
  return toCsv(header, rows);
}
