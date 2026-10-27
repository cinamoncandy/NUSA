/**
 * HOME 최근 기록: the few PAPER events worth a sentence, newest first. Import-free so tests can
 * transpile it alone. Built only from the read-only PAPER learning events the server already sends;
 * nothing is inferred beyond them.
 */
export interface JournalEventInput {
  readonly id: string;
  readonly cycleId: string;
  readonly stage: string;
  readonly occurredAt: number;
  readonly market: string;
  readonly status: "PASS" | "SKIP" | "FAIL";
  readonly reason?: string;
  readonly signal?: { readonly action: "BUY" | "SELL" | "HOLD"; readonly confidence?: number };
  readonly risk?: { readonly status: "PASS" | "SKIP" | "FAIL"; readonly reason: string };
  readonly fill?: { readonly side: "BUY" | "SELL"; readonly quantity: number; readonly price: number; readonly fee: number };
}

export type JournalKind = "fill" | "hold" | "halt" | "quiet";
export interface JournalEntry { readonly id: string; readonly at: number; readonly kind: JournalKind; readonly title: string; readonly detail: string }

const coin = (market: string) => market.replace(/^KRW-/, "");
const krw = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const qty = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 8 });

export function buildJournal(events: readonly JournalEventInput[], limit = 6): readonly JournalEntry[] {
  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt);
  const entries: JournalEntry[] = [];
  let quiet: { from: number; to: number; cycles: Set<string>; id: string } | null = null;
  const flushQuiet = () => {
    if (quiet != null && quiet.cycles.size > 0) {
      entries.push(Object.freeze({ id: `quiet-${quiet.id}`, at: quiet.to, kind: "quiet" as const, title: `사이클 ${quiet.cycles.size}번 동안 대기`, detail: "주문할 만한 신호가 없었습니다." }));
    }
    quiet = null;
  };
  for (const event of sorted) {
    if (event.stage === "FILL" && event.fill != null && event.status === "PASS") {
      flushQuiet();
      const side = event.fill.side === "BUY" ? "매수" : "매도";
      entries.push(Object.freeze({ id: event.id, at: event.occurredAt, kind: "fill" as const, title: `${coin(event.market)} ${qty(event.fill.quantity)} ${side} 체결`, detail: `체결가 ${krw(event.fill.price)} · 수수료 ${krw(event.fill.fee)}` }));
    } else if (event.stage === "RISK" && event.status === "FAIL") {
      flushQuiet();
      const reason = event.risk?.reason ?? event.reason ?? "위험 관리가 보류했습니다.";
      entries.push(Object.freeze({ id: event.id, at: event.occurredAt, kind: "hold" as const, title: `${coin(event.market)} 신호, 주문하지 않음`, detail: reason }));
    } else if (event.stage === "HALT") {
      flushQuiet();
      entries.push(Object.freeze({ id: event.id, at: event.occurredAt, kind: "halt" as const, title: "자동매매 정지", detail: event.reason ?? "안전 조건으로 멈췄습니다." }));
    } else {
      if (quiet == null) quiet = { from: event.occurredAt, to: event.occurredAt, cycles: new Set(), id: event.id };
      quiet.to = event.occurredAt;
      quiet.cycles.add(event.cycleId);
    }
  }
  flushQuiet();
  return Object.freeze(entries.reverse().slice(0, limit));
}

export function journalTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
