import type { PaperPerformanceEvidence } from "./paperPerformanceEvidence";

export interface PaperPerformanceComparisonContext {
  readonly familyId: string;
  readonly evidence: PaperPerformanceEvidence;
}

export function assertPaperPerformanceComparable(
  left: PaperPerformanceComparisonContext,
  right: PaperPerformanceComparisonContext,
): void {
  if (!left.familyId.trim() || left.familyId !== right.familyId) throw new Error("PAPER_PERFORMANCE_FAMILY_MISMATCH");
  const a = left.evidence;
  const b = right.evidence;
  if (a.evidenceKind !== "PAPER" || b.evidenceKind !== "PAPER") throw new Error("PAPER_PERFORMANCE_EVIDENCE_KIND_MISMATCH");
  if (a.periodStartAt !== b.periodStartAt || a.periodEndAt !== b.periodEndAt) throw new Error("PAPER_PERFORMANCE_WINDOW_MISMATCH");
  if (a.benchmarkId !== b.benchmarkId) throw new Error("PAPER_PERFORMANCE_BENCHMARK_MISMATCH");
  if (a.calculationVersion !== b.calculationVersion) throw new Error("PAPER_PERFORMANCE_CALCULATION_MISMATCH");
  if (a.observationCount !== b.observationCount) throw new Error("PAPER_PERFORMANCE_SAMPLE_MISMATCH");
  if (a.authority !== "PAPER_ONLY" || b.authority !== "PAPER_ONLY" || a.liveAuthority !== "NONE" || b.liveAuthority !== "NONE" || a.aiAuthority !== "ZERO_AUTHORITY" || b.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("PAPER_PERFORMANCE_AUTHORITY_MISMATCH");
  }
}
