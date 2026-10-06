import type { PaperLearningScreenState } from "./paperLearningScreen";
import { calmDeltaTone, type CalmTone } from "./uiKitModel";

/**
 * "학습" screen model for the calm redesign: one sentence on where the PAPER loop is, the loop as a
 * short track built only from stages the server actually reported, and the measured results.
 * Missing data is "—" or "받지 못함", never zero or success.
 */
export type LoopStepState = "DONE" | "BLOCKED" | "NONE";
export interface LoopStep { readonly label: string; readonly state: LoopStepState }
export interface LearningRow { readonly label: string; readonly value: string; readonly tone: CalmTone }
export interface LearningScreenModel {
  readonly tone: CalmTone;
  readonly headline: string;
  readonly sub: string;
  readonly steps: readonly LoopStep[];
  readonly narrowest: string | null;
  readonly rows: readonly LearningRow[];
}

const money = (value: number): string => `${value < 0 ? "−" : value > 0 ? "+" : ""}₩${Math.round(Math.abs(value)).toLocaleString("ko-KR")}`;

export function buildLearningScreen(state: PaperLearningScreenState): LearningScreenModel {
  const connected = state.dataSource !== "NOT_CONFIGURED" && state.dataSource !== "UNAVAILABLE" && state.dataSource !== "PROJECTION_ABSENT";
  const riskBlocked = state.latestRisk?.status === "FAIL";
  const steps: LoopStep[] = [
    { label: "관찰", state: state.latestMarket != null ? "DONE" : "NONE" },
    { label: "신호", state: state.latestSignal != null ? "DONE" : "NONE" },
    { label: "판단", state: state.latestDecision != null ? "DONE" : "NONE" },
    { label: "안전", state: state.latestRisk == null ? "NONE" : riskBlocked ? "BLOCKED" : "DONE" },
    { label: "체결", state: state.latestFill != null ? "DONE" : "NONE" },
    { label: "평가", state: state.latestEvidence?.outcome != null ? "DONE" : "NONE" },
  ];
  const tone: CalmTone = !connected ? "ATTENTION" : state.status === "HALTED" || state.status === "ERROR" ? "LOSS" : state.status === "PAUSED" || riskBlocked ? "ATTENTION" : "NORMAL";
  const headline = !connected ? "학습 정보를 받지 못했어요"
    : state.status === "HALTED" ? "학습이 멈춰 있어요"
    : state.status === "ERROR" ? "학습에 오류가 있어요"
    : state.status === "PAUSED" ? "학습이 잠시 쉬고 있어요"
    : "모의투자로 배우는 중이에요";
  const sub = !connected ? "빈 값은 결과가 없다는 뜻이 아니에요"
    : state.halt != null ? "멈춘 이유는 아래 자세히 보기에 있어요"
    : state.latestEvidence?.outcome == null ? "아직 평가 결론은 없어요" : "최근 평가 결론이 있어요";
  const narrowest = riskBlocked ? `가장 좁아지는 곳: 안전 (${state.latestRisk!.reason})` : null;
  const p = state.performance;
  const rows: LearningRow[] = connected ? [
    { label: "실현 손익", value: money(p.realizedPnL), tone: calmDeltaTone(p.realizedPnL) },
    { label: "수수료", value: `₩${Math.round(p.fees).toLocaleString("ko-KR")}`, tone: "NORMAL" },
    { label: "체결된 사이클", value: `${p.filledCycles} / ${p.completedCycles}`, tone: "NORMAL" },
    { label: "승률", value: p.winRate == null ? "—" : `${Math.round(p.winRate * 100)}%`, tone: "NORMAL" },
    { label: "최대 낙폭", value: `${(p.maxDrawdown * 100).toFixed(1)}%`, tone: p.maxDrawdown > 0 ? "LOSS" : "MUTED" },
  ] : [];
  return Object.freeze({ tone, headline, sub, steps: Object.freeze(steps), narrowest, rows: Object.freeze(rows) });
}
