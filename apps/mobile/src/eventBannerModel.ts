/**
 * In-app banner for new PAPER fills and halts, shown on every tab while the app is open. Import-free
 * so tests can transpile it alone. Read-only: it only describes what the server already sent.
 *
 * The cursor remembers the event ids of the last confirmed snapshot (ids, not timestamps, so equal
 * timestamps never hide an event) and whether the runtime was already halted. The first confirmed
 * snapshot, empty or not, only sets the baseline so history never banners.
 */
export interface BannerEvent {
  readonly id: string;
  readonly stage: string;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly fill?: { readonly side: "BUY" | "SELL"; readonly quantity: number; readonly price: number; readonly fee: number };
}
export interface BannerCursor { readonly seen: ReadonlySet<string>; readonly halted: boolean }
export interface Banner { readonly id: string; readonly tone: "fill" | "halt"; readonly title: string; readonly detail: string }

const coin = (market: string) => market.replace(/^KRW-/, "");
const krw = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const qty = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
const later = (a: BannerEvent, b: BannerEvent) => a.occurredAt > b.occurredAt || (a.occurredAt === b.occurredAt && a.id > b.id);

export function advanceBanner(cursor: BannerCursor | null, events: readonly BannerEvent[], halted: boolean): { readonly cursor: BannerCursor; readonly banner: Banner | null } {
  const next: BannerCursor = Object.freeze({ seen: new Set(events.map((event) => event.id)), halted });
  if (cursor == null) return { cursor: next, banner: null };
  if (halted && !cursor.halted) {
    return { cursor: next, banner: Object.freeze({ id: "halt", tone: "halt" as const, title: "자동매매 정지", detail: "안전 조건으로 멈췄습니다." }) };
  }
  let newest: BannerEvent | null = null;
  for (const event of events) {
    if (event.stage !== "FILL" || event.status !== "PASS" || event.fill == null || cursor.seen.has(event.id)) continue;
    if (newest == null || later(event, newest)) newest = event;
  }
  if (newest?.fill == null) return { cursor: next, banner: null };
  const side = newest.fill.side === "BUY" ? "매수" : "매도";
  return { cursor: next, banner: Object.freeze({ id: newest.id, tone: "fill" as const, title: `${coin(newest.market)} ${qty(newest.fill.quantity)} ${side} 체결`, detail: `체결가 ${krw(newest.fill.price)} · 수수료 ${krw(newest.fill.fee)}` }) };
}
