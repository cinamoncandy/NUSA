/** One-line, read-only summary of the research/learning loop for HOME. No new data fetch, no authority. */
export interface LearningLineInput {
  readonly health: string;
  readonly candidateCount: number;
  readonly experimentCount: number;
  readonly evidenceAgeMs?: number;
  readonly metrics: { readonly tradeCount?: number; readonly observationDays?: number; readonly championBetterCount: number; readonly challengerBetterCount: number; readonly equivalentCount: number; readonly inconclusiveCount: number };
}

export interface LearningLine {
  readonly value: string;
  readonly tone: "ok" | "warn" | "muted";
}

const HOUR_MS = 3_600_000;
/** Mirrors the Research candidate gate (researchCandidateGate.ts defaults); display only. */
export const PROMOTION_MIN_TRADES = 50;
export const PROMOTION_MIN_DAYS = 30;

export function promotionProgress(metrics: { readonly tradeCount?: number; readonly observationDays?: number }): string {
  const trades = Number.isFinite(metrics.tradeCount) ? Math.max(0, Math.floor(metrics.tradeCount as number)) : 0;
  const days = Number.isFinite(metrics.observationDays) ? Math.max(0, Math.floor(metrics.observationDays as number)) : 0;
  return `승격 기준 거래 ${trades}/${PROMOTION_MIN_TRADES} · 관측 ${days}/${PROMOTION_MIN_DAYS}일`;
}

function age(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "증거 시각 미상";
  const h = Math.floor(ms / HOUR_MS);
  return h < 1 ? "방금 검증" : h < 48 ? `${h}시간 전 검증` : `${Math.floor(h / 24)}일 전 검증`;
}

export function buildLearningLine(research: LearningLineInput | null): LearningLine {
  if (research == null) return Object.freeze({ value: "리서치 상태 미수신", tone: "muted" as const });
  if (research.experimentCount === 0) return Object.freeze({ value: `후보 ${research.candidateCount} · 실험 아직 없음`, tone: "muted" as const });
  const m = research.metrics;
  const healthy = research.health === "HEALTHY";
  const state = healthy ? age(research.evidenceAgeMs) : research.health === "STALE" ? `검증 오래됨 (${age(research.evidenceAgeMs)})` : "연구 일시 제한";
  return Object.freeze({
    value: `실험 ${research.experimentCount} · 후보 ${research.candidateCount} · 도전자 우세 ${m.challengerBetterCount}/현재 ${m.championBetterCount} · ${state} · ${promotionProgress(m)}`,
    tone: healthy ? "ok" as const : "warn" as const,
  });
}

export interface AiTrustInput {
  readonly status: "AVAILABLE" | "UNAVAILABLE" | "INCOMPLETE";
  readonly calibrationStatus: "UNKNOWN" | "UNVERIFIED" | "INSUFFICIENT_DATA" | "CALIBRATED" | "DEGRADED";
  readonly calibrationSampleCount?: number;
  readonly calibrationExpectedError?: number | null;
  readonly calibrationBrierScore?: number | null;
  readonly calibrationDurabilityStatus?: "DISABLED" | "HEALTHY" | "UNHEALTHY";
}

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read-only AI prediction-trust line. Confidence is shown only when calibration is verified. */
export function buildAiTrustLine(ai: AiTrustInput | null): LearningLine {
  if (ai == null) return Object.freeze({ value: "AI 상태 미수신", tone: "muted" as const });
  if (ai.status === "UNAVAILABLE") return Object.freeze({ value: "AI 분석 사용 불가", tone: "muted" as const });
  const samples = Math.max(0, Math.floor(num(ai.calibrationSampleCount) ?? 0));
  const durable = ai.calibrationDurabilityStatus === "UNHEALTHY" ? " · 보정 기록 저장 이상" : "";
  if (ai.calibrationStatus === "CALIBRATED") {
    const err = num(ai.calibrationExpectedError);
    const brier = num(ai.calibrationBrierScore);
    const parts = [`보정 완료 · 표본 ${samples}`];
    if (err != null) parts.push(`예상 오차 ${(err * 100).toFixed(1)}%p`);
    if (brier != null) parts.push(`Brier ${brier.toFixed(3)}`);
    return Object.freeze({ value: parts.join(" · ") + durable, tone: durable ? "warn" as const : "ok" as const });
  }
  if (ai.calibrationStatus === "INSUFFICIENT_DATA") return Object.freeze({ value: `보정 표본 부족 (${samples}건) · 신뢰도 0으로 취급${durable}`, tone: "warn" as const });
  if (ai.calibrationStatus === "DEGRADED") return Object.freeze({ value: `보정 저하 · 표본 ${samples} · 신뢰 낮춤${durable}`, tone: "warn" as const });
  return Object.freeze({ value: `보정 미검증 · 신뢰도 0으로 취급${durable}`, tone: "warn" as const });
}
