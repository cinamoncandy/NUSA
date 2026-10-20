import type { CalmTone } from "./uiKitModel";

/**
 * "선물" screen model (prepared 2026-10-20 ahead of any futures trading). The server sends no futures state today, so every value
 * here is "—" or "받지 못함", never zero or healthy. `FuturesSnapshotInput` is the display shape the screen will read once a
 * PAPER futures runtime reports; it is validated strictly and anything malformed counts as not received. Presentation only:
 * this model never decides, enables or changes anything.
 */
export interface FuturesPositionInput {
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly quantity: number;
  readonly entryPrice: number;
  readonly markPrice: number;
  /** Unrealized PAPER P&L in KRW. */
  readonly unrealizedPnl: number;
  /** (mark − liquidation) / mark, 0..1. */
  readonly liquidationDistanceRatio: number;
}
export interface FuturesSnapshotInput {
  readonly positions: readonly FuturesPositionInput[];
  /** Today's realized loss as a share of capital, 0..1. */
  readonly dayLossRatio: number;
  readonly consecutiveLosses: number;
}
export interface FuturesLimits { readonly maxDailyLossRatio: number; readonly minLiquidationDistanceRatio: number; readonly maxConsecutiveLosses: number }

export interface FuturesRow { readonly label: string; readonly value: string; readonly tone: CalmTone; readonly hint?: string }
export interface FuturesScreenModel {
  readonly started: boolean;
  readonly headline: readonly [string, string];
  readonly sub: string;
  readonly status: readonly FuturesRow[];
  readonly positions: readonly FuturesRow[];
  readonly usage: readonly FuturesRow[];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const ratio = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
const money = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}₩${Math.round(Math.abs(n)).toLocaleString("ko-KR")}`;
const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;

export function parseFuturesSnapshot(raw: unknown): FuturesSnapshotInput | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.positions) || !ratio(v.dayLossRatio) || typeof v.consecutiveLosses !== "number" || !Number.isSafeInteger(v.consecutiveLosses) || v.consecutiveLosses < 0) return null;
  const positions: FuturesPositionInput[] = [];
  for (const p of v.positions as unknown[]) {
    if (p == null || typeof p !== "object") return null;
    const q = p as Record<string, unknown>;
    if (typeof q.symbol !== "string" || !/^[A-Z0-9_-]{2,20}$/.test(q.symbol) || (q.side !== "LONG" && q.side !== "SHORT") || !finite(q.quantity) || q.quantity <= 0 || !finite(q.entryPrice) || q.entryPrice <= 0 || !finite(q.markPrice) || q.markPrice <= 0 || !finite(q.unrealizedPnl) || !ratio(q.liquidationDistanceRatio)) return null;
    positions.push({ symbol: q.symbol, side: q.side, quantity: q.quantity, entryPrice: q.entryPrice, markPrice: q.markPrice, unrealizedPnl: q.unrealizedPnl, liquidationDistanceRatio: q.liquidationDistanceRatio });
  }
  return { positions, dayLossRatio: v.dayLossRatio as number, consecutiveLosses: v.consecutiveLosses as number };
}

const NOT_RECEIVED = "받지 못함";

export function buildFuturesScreen(raw: unknown, limits: FuturesLimits): FuturesScreenModel {
  const snap = parseFuturesSnapshot(raw);
  const status: FuturesRow[] = [
    { label: "모의 선물 거래", value: snap == null ? "시작 전" : "진행 중", tone: snap == null ? "MUTED" : "NORMAL", hint: snap == null ? "검증을 통과한 선물 전략이 아직 없어요" : undefined },
    { label: "실거래", value: "잠김 · 영구", tone: "ORDER", hint: "선물도 모의투자만 할 수 있어요" },
    { label: "전략 검증", value: "홀드아웃 실패", tone: "ATTENTION", hint: "사전 등록 연구 1건 · 2026-10-20 기록 · 같은 가설은 다시 돌리지 않아요" },
  ];
  if (snap == null) {
    return Object.freeze({
      started: false,
      headline: ["선물 모의는", "시작 전이에요"] as const,
      sub: "서버가 선물 값을 보내지 않아서 아래 칸은 비어 있어요. 비어 있다고 0이라는 뜻은 아니에요.",
      status: Object.freeze(status),
      positions: Object.freeze([{ label: "열린 포지션", value: NOT_RECEIVED, tone: "MUTED" as CalmTone }, { label: "평가 손익", value: "—", tone: "MUTED" as CalmTone }]),
      usage: Object.freeze([
        { label: "오늘 손실", value: "—", tone: "MUTED" as CalmTone, hint: `한도 ${pct(limits.maxDailyLossRatio)}` },
        { label: "연속 손실", value: "—", tone: "MUTED" as CalmTone, hint: `한도 ${limits.maxConsecutiveLosses}번` },
        { label: "청산까지 거리", value: "—", tone: "MUTED" as CalmTone, hint: `최소 ${pct(limits.minLiquidationDistanceRatio)}` },
      ]),
    });
  }
  const total = snap.positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const nearest = snap.positions.length === 0 ? null : Math.min(...snap.positions.map((p) => p.liquidationDistanceRatio));
  const stopped = snap.consecutiveLosses >= limits.maxConsecutiveLosses;
  return Object.freeze({
    started: true,
    headline: stopped ? ["선물 모의는", "쉬고 있어요"] as const : ["선물 모의로", "배우는 중이에요"] as const,
    sub: stopped ? "연속 손실 한도에 닿아서 새 선물 진입을 멈췄어요." : "모의 선물 포지션만 보여줘요. 실제 돈은 쓰지 않아요.",
    status: Object.freeze(status),
    positions: Object.freeze(snap.positions.length === 0
      ? [{ label: "열린 포지션", value: "없음", tone: "NORMAL" as CalmTone }, { label: "평가 손익", value: money(0), tone: "NORMAL" as CalmTone }]
      : [...snap.positions.map((p) => ({ label: `${p.symbol} ${p.side === "LONG" ? "롱" : "숏"}`, value: money(p.unrealizedPnl), tone: (p.unrealizedPnl < 0 ? "LOSS" : "NORMAL") as CalmTone, hint: `진입 ${p.entryPrice.toLocaleString("en-US")} · 현재 ${p.markPrice.toLocaleString("en-US")}` })), { label: "평가 손익 합계", value: money(total), tone: (total < 0 ? "LOSS" : "NORMAL") as CalmTone }]),
    usage: Object.freeze([
      { label: "오늘 손실", value: pct(snap.dayLossRatio), tone: (snap.dayLossRatio >= limits.maxDailyLossRatio ? "LOSS" : snap.dayLossRatio >= limits.maxDailyLossRatio * 0.7 ? "ATTENTION" : "NORMAL") as CalmTone, hint: `한도 ${pct(limits.maxDailyLossRatio)}` },
      { label: "연속 손실", value: `${snap.consecutiveLosses} / ${limits.maxConsecutiveLosses}`, tone: (stopped ? "ATTENTION" : "NORMAL") as CalmTone },
      { label: "청산까지 거리", value: nearest == null ? "—" : pct(nearest), tone: (nearest != null && nearest < limits.minLiquidationDistanceRatio ? "LOSS" : "NORMAL") as CalmTone, hint: `최소 ${pct(limits.minLiquidationDistanceRatio)}` },
    ]),
  });
}
