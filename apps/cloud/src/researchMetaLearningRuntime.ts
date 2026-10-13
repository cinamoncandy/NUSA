import { evaluateMetaLearning, metaLearningSteering, runtimeResearchEntries, type ResearchLedgerEntry } from "../../../packages/contracts/src/researchMetaLearning";
import type { ClosedLearningMetaLearningStatus } from "./closedLearningLoopStatus";

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

export function buildMetaLearningStatus(input: {
  readonly ledger: readonly ResearchLedgerEntry[];
  readonly runtimeTicksByInterval?: Readonly<Record<string, { readonly counts: Readonly<Record<string, number>> } | null>> | null;
  readonly researchMarkets: number;
  readonly shadow?: BaselineShadowSummary;
}): ClosedLearningMetaLearningStatus {
  const live = shadowForwardEntry(input.shadow);
  const runtime = runtimeResearchEntries(input.runtimeTicksByInterval, input.researchMarkets);
  const ledger = live == null ? input.ledger : input.ledger.filter((entry) => entry.source !== "PAPER_FORWARD");
  const report = evaluateMetaLearning([...ledger, ...runtime, ...(live == null ? [] : [live])]);
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
    liveForwardEntries: live == null ? 0 : 1,
    steeringMode: steering.mode,
    longBarTickEvery: steering.longBarTickEvery,
  });
}
