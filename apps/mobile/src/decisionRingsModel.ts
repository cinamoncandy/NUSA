// Presentation-only model for the home "decision rings": every PAPER decision the
// cloud runtime reports becomes one dot on a golden-angle spiral (oldest at the
// centre, newest at the edge). Kept import-free so tests can transpile this file alone.

export interface DecisionRingsInput {
  readonly decisionCount: number | null;
  readonly paperOrderCount: number | null;
  /** Upper bound on drawn dots; large histories are sampled evenly. */
  readonly maxDots?: number;
}

export interface DecisionRingDot {
  /** Position in [-1, 1] relative to the ring centre. */
  readonly x: number;
  readonly y: number;
  /** 0 = oldest decision, 1 = newest. */
  readonly recency: number;
}

export type DecisionRingsState = "UNKNOWN" | "EMPTY" | "WAITING" | "ORDERING";

export interface DecisionRings {
  readonly state: DecisionRingsState;
  readonly decisionCount: number | null;
  readonly paperOrderCount: number | null;
  readonly dots: readonly DecisionRingDot[];
  /** Real decisions represented by each drawn dot (1 when not sampled). */
  readonly decisionsPerDot: number;
  readonly headline: string;
  readonly detail: string;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_MAX_DOTS = 420;

function finiteCount(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function buildDecisionRings(input: DecisionRingsInput): DecisionRings {
  const decisions = finiteCount(input.decisionCount);
  const orders = finiteCount(input.paperOrderCount);
  const maxDots = Math.max(1, Math.floor(input.maxDots ?? DEFAULT_MAX_DOTS));
  const drawn = decisions == null ? 0 : Math.min(decisions, maxDots);
  const dots: DecisionRingDot[] = [];
  for (let i = 0; i < drawn; i += 1) {
    const radius = Math.sqrt((i + 0.5) / drawn);
    const angle = i * GOLDEN_ANGLE;
    dots.push(Object.freeze({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), recency: drawn === 1 ? 1 : i / (drawn - 1) }));
  }
  const state: DecisionRingsState = decisions == null ? "UNKNOWN" : decisions === 0 ? "EMPTY" : (orders ?? 0) > 0 ? "ORDERING" : "WAITING";
  const count = decisions == null ? "—" : decisions.toLocaleString("ko-KR");
  const headline = state === "UNKNOWN" ? "판단 기록을 아직 받지 못했습니다" : `${count}번 판단`;
  const detail =
    state === "UNKNOWN" ? "Cloud PAPER 상태가 연결되면 판단이 나선으로 쌓입니다." :
    state === "EMPTY" ? "아직 판단이 없습니다. 시세를 받으면 첫 판단이 가운데에 생깁니다." :
    state === "WAITING" ? "아직 주문하지 않았습니다. 신호가 약할 때 기다리는 것도 판단입니다." :
    `그중 PAPER 주문 ${(orders ?? 0).toLocaleString("ko-KR")}건이 나갔습니다.`;
  return Object.freeze({
    state,
    decisionCount: decisions,
    paperOrderCount: orders,
    dots: Object.freeze(dots),
    decisionsPerDot: decisions == null || drawn === 0 ? 1 : decisions / drawn,
    headline,
    detail,
  });
}
