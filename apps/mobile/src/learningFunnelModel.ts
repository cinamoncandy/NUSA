/**
 * Learning funnel for the 학습 screen (redesign 2026-10-19): candidates tested -> passed discovery -> passed the independent
 * holdout. Read-only presentation of the server's integers; anything missing, malformed or inconsistent shows nothing rather
 * than a guessed number.
 */
export interface LearningFunnelStage {
  readonly label: string;
  readonly value: number;
  /** Width of the bar relative to the first stage, 0.18..1 (a zero stage keeps a visible sliver). */
  readonly width: number;
  readonly tone: "NORMAL" | "ATTENTION";
}

export interface LearningFunnelModel {
  readonly headline: string;
  readonly sub: string;
  readonly stages: readonly LearningFunnelStage[];
}

const int = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

export function buildLearningFunnel(raw: unknown): LearningFunnelModel | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tested = int(r.configurations); const discovered = int(r.discoveryPasses); const passed = int(r.holdoutPasses); const cycles = int(r.cyclesEvaluated);
  if (tested == null || discovered == null || passed == null || cycles == null || tested === 0 || discovered > tested || passed > tested) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const width = (n: number) => Math.max(0.18, Math.sqrt(n / tested));
  return Object.freeze({
    headline: passed === 0 ? `전략 ${fmt(tested)}개를 시험했고\n끝까지 통과한 건 0개예요` : `전략 ${fmt(tested)}개 중\n${fmt(passed)}개가 독립 검증을 통과했어요`,
    sub: passed === 0 ? "과거 데이터에선 맞아도 새 데이터에선 틀렸어요. 기준은 낮추지 않아요." : `완주한 학습 사이클 ${fmt(cycles)}번`,
    stages: Object.freeze([
      Object.freeze({ label: "시험한 전략", value: tested, width: 1, tone: "NORMAL" as const }),
      Object.freeze({ label: "1차 통과", value: discovered, width: width(discovered), tone: "NORMAL" as const }),
      Object.freeze({ label: "독립 검증 합격", value: passed, width: width(passed), tone: passed === 0 ? "ATTENTION" as const : "NORMAL" as const }),
    ]),
  });
}
