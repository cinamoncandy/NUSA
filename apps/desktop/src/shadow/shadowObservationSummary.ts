import type { ShadowEvidenceBusDiagnostics } from "../shadow/shadowEvidenceBus";
import type { ShadowEvidenceVerification } from "./shadowEvidenceArchive";
import type { ShadowOperationalDiagnostics } from "./shadowOperationalRuntime";

/**
 * The end-of-session report for a WO-0034-A4 observation.
 *
 * The verdict is computed from measurements, never asserted by the caller. In particular
 * there is no input that means "this run was fine" -- PASS is only reachable when every
 * safety condition and the archive's own independent verification agree, so a caller cannot
 * hand this module a conclusion and have it repeated back.
 */

export type ShadowObservationVerdict = "PASS" | "FAIL" | "RECOVERY_REQUIRED";

export interface ShadowObservationSummaryInput {
  readonly diagnostics: ShadowOperationalDiagnostics;
  readonly evidence: ShadowEvidenceBusDiagnostics | null;
  readonly verification: ShadowEvidenceVerification | null;
  /** Which completion marker the sealed archive actually carries, read from disk. */
  readonly completionMarker: "COMPLETED" | "ABORTED" | "NONE";
  readonly evidenceRecoveryState: "NONE" | "RECOVERY_REQUIRED";
  /** Observed private-API calls. Structurally 0: no such call site exists in this build. */
  readonly privateApiCallCount: number;
  readonly endedAt: number;
}

export interface ShadowObservationSummary {
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly market: string;
  readonly candleCount: number;
  readonly duplicateCandleCount: number;
  readonly staleCandleCount: number;
  readonly outOfOrderCandleCount: number;
  readonly signalCount: number;
  readonly publishedEvents: number;
  readonly deliveredEvents: number;
  readonly duplicateEvents: number;
  readonly queueHighWaterMark: number;
  readonly runtimeFinalState: string;
  readonly haltReason: string | null;
  readonly evidenceVerification: string;
  readonly completionMarker: "COMPLETED" | "ABORTED" | "NONE";
  readonly brokerMutation: number;
  readonly orderMutation: number;
  readonly fillMutation: number;
  readonly cashMutation: number;
  readonly positionMutation: number;
  readonly privateApiCalls: number;
  readonly completionReason: string | null;
  readonly executionGateCallCount: number;
  readonly brokerCallCount: number;
  readonly safeCompletion: "SAFE_COMPLETION" | "NOT_SAFE_COMPLETION";
  readonly verdict: ShadowObservationVerdict;
  /** Why the verdict is what it is. Empty only for PASS. */
  readonly verdictReasons: readonly string[];
}

/** Runtime states that represent a session that ended the way it was supposed to. */
const CLEAN_FINAL_STATES = new Set(["COMPLETED"]);

/**
 * Blockers that explain a normal ending rather than report a fault.
 *
 * Reaching the configured session ceiling is the observation working as designed, so it is
 * recorded and reported but does not fail the verdict. Nothing else belongs in this set: any
 * blocker added here stops failing the run, which is precisely the kind of change that turns
 * an honest verdict into a flattering one.
 */
const BENIGN_BLOCKERS: ReadonlySet<string> = new Set(["MAX_SESSION_DURATION_REACHED"]);

export function buildShadowObservationSummary(input: ShadowObservationSummaryInput): ShadowObservationSummary {
  const d = input.diagnostics;
  const reasons: string[] = [];

  if (input.evidenceRecoveryState === "RECOVERY_REQUIRED") reasons.push("EVIDENCE_RECOVERY_REQUIRED");
  if (!CLEAN_FINAL_STATES.has(d.state)) reasons.push(`RUNTIME_FINAL_STATE:${d.state}`);
  for (const blocker of d.blockers) {
    if (!BENIGN_BLOCKERS.has(blocker)) reasons.push(`BLOCKER:${blocker}`);
  }

  if (input.evidence === null) reasons.push("NO_EVIDENCE_BUS");
  else if (input.evidence.status === "HALTED") reasons.push(`EVIDENCE_BUS_HALTED:${input.evidence.haltReason ?? "UNKNOWN"}`);

  // An archive that was never verified is not a passing archive. Absent verification is
  // treated as failure, not as "nothing to report".
  if (input.verification === null) reasons.push("EVIDENCE_NOT_VERIFIED");
  else if (input.verification.status !== "PASS") reasons.push(`EVIDENCE_VERIFICATION:${input.verification.status}`, ...input.verification.blockers.map((blocker) => `EVIDENCE_${blocker}`));

  if (input.completionMarker !== "COMPLETED") reasons.push(`COMPLETION_MARKER:${input.completionMarker}`);

  // The counters come from two independent places -- the live runtime and the re-read
  // archive -- and both must be zero. Trusting only one would let a session that mutated
  // something pass on the strength of the other's silence.
  const mutations: readonly (readonly [string, number])[] = [
    ["BROKER", d.actualBrokerCallCount],
    ["ORDER", d.actualOrderCount],
    ["FILL", d.actualFillCount],
    ["CASH", d.cashMutationCount],
    ["POSITION", d.positionMutationCount],
    ["ARCHIVE_BROKER", input.verification?.actualBrokerCalls ?? 0],
    ["ARCHIVE_ORDER", input.verification?.actualOrders ?? 0],
    ["ARCHIVE_FILL", input.verification?.actualFills ?? 0],
    ["ARCHIVE_CASH", input.verification?.cashMutations ?? 0],
    ["ARCHIVE_POSITION", input.verification?.positionMutations ?? 0]
  ];
  for (const [name, value] of mutations) {
    if (value !== 0) reasons.push(`MUTATION_${name}:${value}`);
  }
  if (input.privateApiCallCount !== 0) reasons.push(`PRIVATE_API_CALLS:${input.privateApiCallCount}`);

  const verdict: ShadowObservationVerdict =
    input.evidenceRecoveryState === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED"
      : reasons.length === 0 ? "PASS"
        : "FAIL";

  return Object.freeze({
    sessionId: d.sessionId,
    startedAt: d.startedAt,
    endedAt: input.endedAt,
    durationMs: d.startedAt === null ? 0 : Math.max(0, input.endedAt - d.startedAt),
    market: d.symbol,
    candleCount: d.closedCandleCount,
    duplicateCandleCount: d.duplicateCandleCount,
    staleCandleCount: d.staleCandleCount,
    outOfOrderCandleCount: d.outOfOrderCandleCount,
    signalCount: d.signalCount,
    publishedEvents: input.evidence?.published ?? 0,
    deliveredEvents: input.evidence?.delivered ?? 0,
    duplicateEvents: input.evidence?.duplicatesDropped ?? 0,
    queueHighWaterMark: input.evidence?.highWaterMark ?? 0,
    runtimeFinalState: d.state,
    haltReason: input.evidence?.haltReason ?? (d.blockers.length > 0 ? d.blockers[0]! : null),
    evidenceVerification: input.verification?.status ?? "NOT_VERIFIED",
    completionMarker: input.completionMarker,
    brokerMutation: d.actualBrokerCallCount,
    orderMutation: d.actualOrderCount,
    fillMutation: d.actualFillCount,
    cashMutation: d.cashMutationCount,
    positionMutation: d.positionMutationCount,
    privateApiCalls: input.privateApiCallCount,
    completionReason: d.blockers.find((blocker) => BENIGN_BLOCKERS.has(blocker)) ?? null,
    executionGateCallCount: d.executionGateCallCount ?? 0,
    brokerCallCount: d.actualBrokerCallCount,
    safeCompletion: d.state === "COMPLETED" && d.actualOrderCount === 0 && d.actualFillCount === 0 && d.cashMutationCount === 0 && d.positionMutationCount === 0 && (d.executionGateCallCount ?? 0) === 0 && d.actualBrokerCallCount === 0 && input.privateApiCallCount === 0 ? "SAFE_COMPLETION" : "NOT_SAFE_COMPLETION",
    verdict,
    verdictReasons: Object.freeze([...new Set(reasons)].sort())
  });
}

/** Renders the summary in the report shape the WO asks for. Contains no paths and no secrets. */
export function formatShadowObservationSummary(summary: ShadowObservationSummary): string {
  const lines = [
    "[A4 Shadow Observation Summary]",
    `- sessionId: ${summary.sessionId ?? "(none)"}`,
    `- start time: ${summary.startedAt ?? "(none)"}`,
    `- end time: ${summary.endedAt}`,
    `- duration: ${summary.durationMs}ms`,
    `- market: ${summary.market}`,
    `- candle count: ${summary.candleCount}`,
    `- signal count: ${summary.signalCount}`,
    `- published events: ${summary.publishedEvents}`,
    `- delivered events: ${summary.deliveredEvents}`,
    `- duplicate events: ${summary.duplicateEvents}`,
    `- queue high-water mark: ${summary.queueHighWaterMark}`,
    `- runtime final state: ${summary.runtimeFinalState}`,
    `- halt reason: ${summary.haltReason ?? "(none)"}`,
    `- Evidence verification: ${summary.evidenceVerification}`,
    `- completion marker: ${summary.completionMarker}`,
    `- broker mutation: ${summary.brokerMutation}`,
    `- order mutation: ${summary.orderMutation}`,
    `- fill mutation: ${summary.fillMutation}`,
    `- cash mutation: ${summary.cashMutation}`,
    `- position mutation: ${summary.positionMutation}`,
    `- private API calls: ${summary.privateApiCalls}`,
    `- completion reason: ${summary.completionReason ?? "(none)"}`,
    `- execution gate calls: ${summary.executionGateCallCount}`,
    `- broker calls: ${summary.brokerCallCount}`,
    `- safety: ${summary.safeCompletion}`,
    `- final verdict: ${summary.verdict}`
  ];
  if (summary.verdictReasons.length > 0) lines.push(`- verdict reasons: ${summary.verdictReasons.join(", ")}`);
  return lines.join("\n");
}
