/**
 * The four things the owner looks at first, always visible on HOME: which coin is traded, whether BUY signals
 * are coming, how steady the market feed is, and how far learning has come. Presentation only: it arranges the
 * lines the other screen models already computed and invents nothing. An unknown tone reads as "muted" so
 * uncertainty is never shown as healthy.
 */
export type VitalTone = "ok" | "warn" | "muted";
export type VitalId = "coin" | "buy" | "feed" | "learning";

export interface VitalLineInput {
  readonly value?: unknown;
  readonly detail?: unknown;
  readonly tone?: unknown;
}

export interface Vital {
  readonly id: VitalId;
  readonly label: string;
  readonly value: string;
  readonly detail: string | null;
  readonly tone: VitalTone;
}

export const VITAL_LABELS: Readonly<Record<VitalId, string>> = Object.freeze({
  coin: "거래 코인",
  buy: "BUY 신호",
  feed: "시세 연결",
  learning: "학습 데이터",
});

/** Test ids the earlier detail rows carried; kept on the tiles so acceptance hooks and tests keep finding them. */
export const VITAL_TEST_IDS: Readonly<Record<VitalId, string>> = Object.freeze({
  coin: "home-traded-coin-line",
  buy: "home-buy-signal-line",
  feed: "home-feed-line",
  learning: "home-research-progress-line",
});

const NOT_REPORTED = "집계 미수신";
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const tone = (v: unknown): VitalTone => (v === "ok" || v === "warn" ? v : "muted");

export const UNVERIFIED_NOTE = "재확인 중 · 마지막으로 받은 값";
export const FEED_STALE_NOTE = "지금 시세가 오래됨";

function vital(id: VitalId, line: VitalLineInput | null | undefined, unverified: boolean, feedStale: boolean): Vital {
  const value = text(line?.value);
  if (value == null) return Object.freeze({ id, label: VITAL_LABELS[id], value: NOT_REPORTED, detail: null, tone: "muted" as const });
  let t: VitalTone = value === NOT_REPORTED ? "muted" : tone(line?.tone);
  let detail = text(line?.detail);
  // The server's history can read clean while what the app sees right now is not: never show that as healthy.
  if (id === "feed" && feedStale && t === "ok") { t = "warn"; detail = detail == null ? FEED_STALE_NOTE : `${FEED_STALE_NOTE} · ${detail}`; }
  // A value the app is still re-verifying is shown as the last known one, never as a current healthy reading.
  if (unverified && t !== "muted") { t = "muted"; detail = detail == null ? UNVERIFIED_NOTE : `${UNVERIFIED_NOTE} · ${detail}`; }
  return Object.freeze({ id, label: VITAL_LABELS[id], value, detail, tone: t });
}

/** Fixed order: coin, BUY signals, feed, learning. */
export function buildHomeVitals(input: {
  readonly coin?: VitalLineInput | null;
  readonly buy?: VitalLineInput | null;
  readonly feed?: VitalLineInput | null;
  readonly learning?: VitalLineInput | null;
  /** True while the session is being recovered or the snapshot is a cached one: nothing is shown as healthy. */
  readonly unverified?: boolean;
  /** True when the public quotation feed the app is looking at right now is stale. */
  readonly feedStale?: boolean;
}): readonly Vital[] {
  const u = input.unverified === true;
  const f = input.feedStale === true;
  return Object.freeze([vital("coin", input.coin, u, f), vital("buy", input.buy, u, f), vital("feed", input.feed, u, f), vital("learning", input.learning, u, f)]);
}
