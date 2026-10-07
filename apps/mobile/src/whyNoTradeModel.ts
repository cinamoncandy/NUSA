/**
 * Explains, in plain Korean, why the latest PAPER decision did not trade, from the numbers and the strategy
 * reason the cloud reports. Presentation only: it states what was reported (never a guess), shows nothing when
 * the detail is missing or malformed, and cannot influence any decision. The 0.35 / 0.55 thresholds mirror the
 * cloud's fallback decision rule and are used only to word the comparison.
 */
export interface DecisionDetail {
  readonly action: string;
  readonly score: number;
  readonly confidence: number;
  readonly risk: string;
  readonly hasPosition: boolean;
  readonly strategyAction?: string;
  readonly reason?: string;
  readonly observedAt: number;
}

export const FALLBACK_SCORE_THRESHOLD = 0.35;
export const FALLBACK_CONFIDENCE_THRESHOLD = 0.55;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (v: number): string => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(v * 10_000) / 10_000));
const code = (v: unknown): boolean => typeof v === "string" && /^[A-Z_]{2,16}$/.test(v);

export function isDecisionDetail(value: unknown): value is DecisionDetail {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return code(v.action) && code(v.risk) && num(v.score) != null && num(v.confidence) != null
    && typeof v.hasPosition === "boolean" && num(v.observedAt) != null
    && (v.strategyAction === undefined || code(v.strategyAction))
    && (v.reason === undefined || typeof v.reason === "string");
}

const ACTION_TEXT: Readonly<Record<string, string>> = Object.freeze({
  WAIT: "지금은 관망합니다.", HOLD: "보유를 유지합니다.", BUY: "매수 판단이 나왔습니다.", SELL: "매도 판단이 나왔습니다.",
  REDUCE: "비중을 줄이는 판단입니다.", EXIT: "정리하는 판단입니다.",
});

/** Reads the indicator numbers the candidate strategies put in their reason code. */
function explainStrategyReason(reason: string | undefined, strategyAction: string | undefined, hasPosition: boolean): string | null {
  if (reason != null) {
    const sma = /SMA_CROSSOVER:(\d+)\/(\d+):short=(-?[\d.]+):long=(-?[\d.]+)/.exec(reason);
    if (sma != null) {
      const short = Number(sma[3]);
      const long = Number(sma[4]);
      if (Number.isFinite(short) && Number.isFinite(long)) {
        const dir = short > long ? "위" : short < long ? "아래" : "같음";
        return `이동평균 ${sma[1]}/${sma[2]}: 단기 ${fmt(short)} · 장기 ${fmt(long)} (단기가 장기${dir === "같음" ? "와 같음" : ` ${dir}`}). 교차해야 신호가 납니다.`;
      }
    }
    const insufficient = /INSUFFICIENT_[A-Z_]+_OBSERVATIONS:(\d+)\/(\d+)/.exec(reason);
    if (insufficient != null) return `판단에 필요한 시세가 아직 부족합니다 (${insufficient[1]}/${insufficient[2]}개 수집).`;
    const donchian = /DONCHIAN_BREAKOUT:(\d+):.*?high=(-?[\d.]+):low=(-?[\d.]+)/.exec(reason);
    if (donchian != null) return `최근 ${donchian[1]}개 구간의 고점 ${fmt(Number(donchian[2]))}을 넘어야 매수, 저점 ${fmt(Number(donchian[3]))} 아래로 내려가야 매도합니다. 아직 구간 안입니다.`;
    const rsi = /RSI_MEAN_REVERSION:(\d+):(-?[\d.]+)\/(-?[\d.]+)/.exec(reason);
    if (rsi != null) return `RSI ${rsi[1]}: ${rsi[2]} 아래에서 되돌아오면 매수, ${rsi[3]} 위에서 내려오면 매도합니다. 아직 해당 구간이 아닙니다.`;
  }
  if (strategyAction === "BUY" && hasPosition) return "이미 보유 중이라 추가 매수는 하지 않습니다.";
  if (strategyAction === "SELL" && !hasPosition) return "보유한 포지션이 없어 매도할 것이 없습니다.";
  if (strategyAction != null && !hasPosition) return `전략 판단은 ${strategyAction}이며 진입 신호가 아직 없습니다.`;
  if (strategyAction != null) return `전략 판단은 ${strategyAction}입니다.`;
  return null;
}

/** Up to three short lines, or an empty list when there is nothing reliable to say. */
export function explainDecision(detail: unknown): readonly string[] {
  if (!isDecisionDetail(detail)) return Object.freeze([]);
  const lines: string[] = [];
  lines.push(`최근 판단: ${detail.action} — ${ACTION_TEXT[detail.action] ?? "판단 결과입니다."}`);
  if ((detail.risk === "HIGH" || detail.risk === "CRITICAL") && !detail.hasPosition) {
    lines.push(`위험 등급이 ${detail.risk}라 새로 진입하지 않습니다.`);
  } else {
    const strategy = explainStrategyReason(detail.reason, detail.strategyAction, detail.hasPosition);
    if (strategy != null) lines.push(strategy);
    else lines.push(`종합 점수 ${fmt(detail.score)} (매수 ${FALLBACK_SCORE_THRESHOLD} 이상), 신뢰도 ${fmt(detail.confidence)} (${FALLBACK_CONFIDENCE_THRESHOLD} 이상 필요) — 기준에 못 미쳐 신호가 없습니다.`);
  }
  return Object.freeze(lines);
}
