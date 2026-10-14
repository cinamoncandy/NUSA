import { evaluateMetaLearning, metaLearningSteering, runtimeResearchEntries, type ResearchLedgerEntry } from "../../../packages/contracts/src/researchMetaLearning";
import type { ClosedLearningMetaLearningStatus } from "./closedLearningLoopStatus";
import { createHash } from "node:crypto";

/**
 * Evaluates the research meta-learning policy at runtime over three evidence sources, so the learning about learning is recomputed
 * automatically instead of only when someone runs the offline CLI:
 * - the reviewed offline ledger compiled into the build (researchLedgerSnapshot.ts),
 * - this process's runtime Research evaluations (per bar length),
 * - the live owner-baseline SHADOW totals, which replace the ledger's recorded PAPER_FORWARD snapshot (never counted twice).
 * It also carries the steering decision (metaLearningSteering): how often the longer-bar runtime orchestrators tick. It changes no
 * budget, threshold, qualification, Risk or authority.
 */
export interface BaselineShadowSummary {
  readonly trades: number;
  readonly grossGainBp: number;
  readonly grossLossBp: number;
  readonly feeBp: number;
}

/** A live forward entry passes only with at least 50 round trips and a positive net after fees. */
export function shadowForwardEntry(shadow: BaselineShadowSummary | undefined): ResearchLedgerEntry | undefined {
  if (shadow == null || ![shadow.trades, shadow.grossGainBp, shadow.grossLossBp, shadow.feeBp].every((n) => Number.isSafeInteger(n) && n >= 0) || shadow.trades === 0) return undefined;
  const net = shadow.grossGainBp - shadow.grossLossBp - shadow.feeBp;
  return Object.freeze({ id: "LIVE_BASELINE_SHADOW", source: "PAPER_FORWARD" as const, dataType: "CLOSE" as const, timeframe: "1m", universe: 1, methodClass: "RULE" as const, configs: 1, discoveryPass: 0, holdoutPass: shadow.trades >= 50 && net > 0 ? 1 : 0 });
}

/** A realized canonical PAPER period of the owner baseline, reduced to what meta-learning consumes. */
export interface RealizedPaperPeriodEvidence {
  readonly recordId: string;
  readonly netReturn: number;
  readonly benchmarkReturn: number;
  readonly outcomeFingerprint?: string;
}

/**
 * Performance Evidence N -> Research N+1: the canonical PAPER ledger's realized baseline periods become one PAPER_FORWARD
 * entry. It adds no configuration (it is the same rule the shadow and the ledger snapshot already count) and passes only with
 * at least 20 periods whose mean net return is positive AND above the mean benchmark return. The fingerprint identifies exactly
 * which periods were consumed, so a later Research decision can be traced to them.
 */
export function paperLedgerForwardEntry(periods: readonly RealizedPaperPeriodEvidence[]): { readonly entry: ResearchLedgerEntry; readonly netBp: number; readonly excessBp: number; readonly fingerprint: string } | undefined {
  const valid = periods.filter((p) => typeof p.recordId === "string" && p.recordId.length > 0 && Number.isFinite(p.netReturn) && Number.isFinite(p.benchmarkReturn));
  if (valid.length === 0) return undefined;
  const sorted = [...valid].sort((a, b) => a.recordId.localeCompare(b.recordId));
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  const net = mean(sorted.map((p) => p.netReturn));
  const excess = net - mean(sorted.map((p) => p.benchmarkReturn));
  const fingerprint = createHash("sha256").update(sorted.map((p) => `${p.recordId}:${p.outcomeFingerprint ?? ""}`).join("\n")).digest("hex");
  return Object.freeze({
    entry: Object.freeze({ id: "LIVE_PAPER_LEDGER_BASELINE", source: "PAPER_FORWARD" as const, dataType: "CLOSE" as const, timeframe: "1m", universe: 1, methodClass: "RULE" as const, configs: 0, discoveryPass: 0, holdoutPass: sorted.length >= 20 && net > 0 && excess > 0 ? 1 : 0 }),
    netBp: Math.round(net * 10_000),
    excessBp: Math.round(excess * 10_000),
    fingerprint,
  });
}

export function buildMetaLearningStatus(input: {
  readonly ledger: readonly ResearchLedgerEntry[];
  readonly runtimeTicksByInterval?: Readonly<Record<string, { readonly counts: Readonly<Record<string, number>> } | null>> | null;
  readonly researchMarkets: number;
  readonly shadow?: BaselineShadowSummary;
  readonly paperPeriods?: readonly RealizedPaperPeriodEvidence[];
}): ClosedLearningMetaLearningStatus {
  const live = shadowForwardEntry(input.shadow);
  const paper = paperLedgerForwardEntry(input.paperPeriods ?? []);
  const runtime = runtimeResearchEntries(input.runtimeTicksByInterval, input.researchMarkets);
  const ledger = live == null ? input.ledger : input.ledger.filter((entry) => entry.source !== "PAPER_FORWARD");
  const report = evaluateMetaLearning([...ledger, ...runtime, ...(live == null ? [] : [live]), ...(paper == null ? [] : [paper.entry])]);
  const recommended = report.ranked[0];
  const steering = metaLearningSteering(report, input.researchMarkets);
  return Object.freeze({
    experiments: report.experiments,
    configurations: report.configurations,
    discoveryPasses: report.discoveryPasses,
    holdoutPasses: report.holdoutPasses,
    ...(report.overfitRatePercent === undefined ? {} : { overfitRatePercent: report.overfitRatePercent }),
    validKnowledgePer100Configs: report.validKnowledgePer100Configs,
    exhausted: report.exhausted.join(","),
    ...(report.recommended === undefined ? {} : { recommended: report.recommended }),
    recommendedPrerequisites: recommended == null ? "" : recommended.prerequisites.join(","),
    nextHoldoutBarMicros: Math.round(report.nextHoldoutBar * 1_000_000),
    runtimeEntries: runtime.length,
    liveForwardEntries: (live == null ? 0 : 1) + (paper == null ? 0 : 1),
    paperPeriodsConsumed: paper == null ? 0 : (input.paperPeriods ?? []).length,
    ...(paper == null ? {} : { paperNetBp: paper.netBp, paperExcessBp: paper.excessBp, paperEvidenceFingerprint: paper.fingerprint }),
    steeringMode: steering.mode,
    longBarTickEvery: steering.longBarTickEvery,
  });
}
