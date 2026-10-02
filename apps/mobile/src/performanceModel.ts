/**
 * More → 성과: plain rows from the PAPER performance the app already derives from server events.
 * Import-free. Rows appear only for a server-sourced projection; anything else is not evidence.
 */
export interface PerformanceInput {
  readonly realizedPnL: number; readonly unrealizedPnL: number; readonly fees: number; readonly turnover: number;
  readonly completedCycles: number; readonly filledCycles: number;
  readonly winRate: number | null; readonly expectancy: number | null; readonly maxDrawdown: number;
}
export interface PerformanceRow { readonly label: string; readonly value: string; readonly tone: "neutral" | "pos" | "neg" }
export interface PerformanceScreen { readonly available: boolean; readonly headline: string; readonly rows: readonly PerformanceRow[] }

const won = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}₩${Math.abs(Math.round(v)).toLocaleString("ko-KR")}`;
const plain = (v: number) => `₩${Math.round(v).toLocaleString("ko-KR")}`;
const tone = (v: number): PerformanceRow["tone"] => (v > 0 ? "pos" : v < 0 ? "neg" : "neutral");

export function buildPerformanceScreen(performance: PerformanceInput, serverSourced: boolean): PerformanceScreen {
  if (!serverSourced) return Object.freeze({ available: false, headline: "서버 PAPER 기록이 연결되면 성과를 표시합니다.", rows: Object.freeze([]) });
  const total = performance.realizedPnL + performance.unrealizedPnL;
  const rows: PerformanceRow[] = [
    { label: "총 손익", value: won(total), tone: tone(total) },
    { label: "실현 손익", value: won(performance.realizedPnL), tone: tone(performance.realizedPnL) },
    { label: "평가 손익", value: won(performance.unrealizedPnL), tone: tone(performance.unrealizedPnL) },
    { label: "승률", value: performance.winRate == null ? "아직 없음" : `${Math.round(performance.winRate * 100)}%`, tone: "neutral" },
    { label: "거래당 기대값", value: performance.expectancy == null ? "아직 없음" : won(performance.expectancy), tone: performance.expectancy == null ? "neutral" : tone(performance.expectancy) },
    { label: "최대 낙폭", value: performance.maxDrawdown === 0 ? "없음" : `−₩${Math.abs(Math.round(performance.maxDrawdown)).toLocaleString("ko-KR")}`, tone: performance.maxDrawdown === 0 ? "neutral" : "neg" },
    { label: "수수료", value: plain(performance.fees), tone: "neutral" },
    { label: "거래 대금", value: plain(performance.turnover), tone: "neutral" },
    { label: "체결 사이클 / 전체", value: `${performance.filledCycles.toLocaleString("ko-KR")} / ${performance.completedCycles.toLocaleString("ko-KR")}`, tone: "neutral" },
  ];
  const headline = performance.filledCycles === 0 ? "아직 체결이 없어 성과를 판단하기 이릅니다." : `체결 사이클 ${performance.filledCycles}개 기준 PAPER 성과입니다.`;
  return Object.freeze({ available: true, headline, rows: Object.freeze(rows.map((row) => Object.freeze(row))) });
}

/** Equity points from server PAPER events that carry an account snapshot, oldest first, last 7 days. */
export interface EquityEventInput { readonly occurredAt: number; readonly account?: { readonly equity: number } }
export interface EquityPoint { readonly at: number; readonly equity: number }
export function buildEquitySeries(events: readonly EquityEventInput[], nowMs: number, days = 7): readonly EquityPoint[] {
  const from = nowMs - days * 24 * 60 * 60 * 1000;
  const points = events
    .filter((event) => event.account != null && Number.isFinite(event.account.equity) && event.occurredAt >= from && event.occurredAt <= nowMs)
    .map((event) => ({ at: event.occurredAt, equity: (event.account as { equity: number }).equity }))
    .sort((a, b) => a.at - b.at);
  // One point per distinct equity change keeps the line honest and light.
  const out: EquityPoint[] = [];
  for (const point of points) if (out.length === 0 || out[out.length - 1].equity !== point.equity) out.push(Object.freeze(point));
  return Object.freeze(out);
}
