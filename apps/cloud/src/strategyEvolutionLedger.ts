import { createHash } from "node:crypto";

export type EvolutionLedgerDecision = "PROMOTE" | "HOLD" | "DEMOTE" | "QUARANTINE" | "RETIRE" | "ABSTAIN" | "REJECT";
export type EvolutionLedgerEvidenceKind = "PAPER_OUTCOME" | "CALIBRATION" | "REGIME" | "COST" | "DRAWDOWN" | "PROVENANCE" | "INFRASTRUCTURE" | "COUNTERFACTUAL";

export interface StrategyEvolutionLedgerEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly candidateVersion: string;
  readonly codeSha: string;
  readonly datasetFingerprintSha256: string;
  readonly parameterFingerprintSha256: string;
  readonly parentLineageId: string | null;
  readonly evidenceKind: EvolutionLedgerEvidenceKind;
  readonly evidenceFingerprintSha256: string;
  readonly independentEvidenceId: string;
  readonly decision: EvolutionLedgerDecision;
  readonly occurredAt: string;
  readonly previousEntrySha256: string | null;
  readonly entrySha256: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface StrategyEvolutionLedgerReplayInput {
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly regime: string;
  readonly events: readonly StrategyEvolutionLedgerEvent[];
}

export interface StrategyEvolutionLedgerReplayResult {
  readonly accepted: boolean;
  readonly reasons: readonly string[];
  readonly eventCount: number;
  readonly lastSequence: number | null;
  readonly lastEntrySha256: string | null;
  readonly decisions: Readonly<Record<EvolutionLedgerDecision, number>>;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const sha256 = /^[a-f0-9]{64}$/i;
const freeze = <T>(value: T): T => Object.freeze(value);

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ledger number must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("unsupported ledger value");
}

export function computeStrategyEvolutionLedgerEntrySha256(event: Omit<StrategyEvolutionLedgerEvent, "entrySha256">): string {
  return createHash("sha256").update(canonical(event), "utf8").digest("hex");
}

function validateEventShape(event: StrategyEvolutionLedgerEvent): void {
  if (!event.eventId.trim() || !event.candidateId.trim() || !event.strategyFamilyId.trim() || !event.regime.trim()) throw new Error("ledger identity is required");
  if (!event.candidateVersion.trim() || !event.codeSha.trim() || !event.independentEvidenceId.trim()) throw new Error("ledger lineage is incomplete");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error("sequence must be a non-negative integer");
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new Error("occurredAt must be a valid timestamp");
  for (const [label, value] of [
    ["datasetFingerprintSha256", event.datasetFingerprintSha256],
    ["parameterFingerprintSha256", event.parameterFingerprintSha256],
    ["evidenceFingerprintSha256", event.evidenceFingerprintSha256],
    ["entrySha256", event.entrySha256],
  ] as const) {
    if (!sha256.test(value)) throw new Error(`${label} must be sha256`);
  }
  if (event.previousEntrySha256 !== null && !sha256.test(event.previousEntrySha256)) throw new Error("previousEntrySha256 must be sha256 or null");
  if (event.liveAuthority !== "NONE" || event.productionMutationAllowed !== false || event.aiAuthority !== "ZERO_AUTHORITY") throw new Error("ledger authority invariant failed");
}

export function replayStrategyEvolutionLedger(input: StrategyEvolutionLedgerReplayInput): StrategyEvolutionLedgerReplayResult {
  const reasons: string[] = [];
  const eventIds = new Set<string>();
  const evidenceFingerprints = new Set<string>();
  const independentEvidenceIds = new Set<string>();
  const decisionCounts: Record<EvolutionLedgerDecision, number> = {
    PROMOTE: 0, HOLD: 0, DEMOTE: 0, QUARANTINE: 0, RETIRE: 0, ABSTAIN: 0, REJECT: 0,
  };

  let previousSha: string | null = null;
  let previousSequence: number | null = null;

  for (const event of input.events) {
    validateEventShape(event);
    if (event.candidateId !== input.candidateId || event.strategyFamilyId !== input.strategyFamilyId || event.regime !== input.regime) reasons.push("IDENTITY_MISMATCH");
    if (eventIds.has(event.eventId) || evidenceFingerprints.has(event.evidenceFingerprintSha256)) reasons.push("DUPLICATE_OR_REPLAYED_EVENT");
    if (independentEvidenceIds.has(event.independentEvidenceId)) reasons.push("NON_INDEPENDENT_EVIDENCE_REUSE");
    eventIds.add(event.eventId);
    evidenceFingerprints.add(event.evidenceFingerprintSha256);
    independentEvidenceIds.add(event.independentEvidenceId);

    if (previousSequence === null) {
      if (event.sequence !== 0 || event.previousEntrySha256 !== null) reasons.push("INVALID_LEDGER_GENESIS");
    } else {
      if (event.sequence !== previousSequence + 1) reasons.push("OUT_OF_ORDER_SEQUENCE");
      if (event.previousEntrySha256 !== previousSha) reasons.push("BROKEN_HASH_CHAIN");
    }

    const { entrySha256, ...unsigned } = event;
    const expected = computeStrategyEvolutionLedgerEntrySha256(unsigned);
    if (expected !== entrySha256) reasons.push("ENTRY_FINGERPRINT_MISMATCH");

    if (event.evidenceKind === "COUNTERFACTUAL" && event.decision === "PROMOTE") reasons.push("COUNTERFACTUAL_CANNOT_PROMOTE");

    decisionCounts[event.decision] += 1;
    previousSha = event.entrySha256;
    previousSequence = event.sequence;
  }

  return freeze({
    accepted: reasons.length === 0,
    reasons: freeze([...new Set(reasons)].sort()),
    eventCount: input.events.length,
    lastSequence: previousSequence,
    lastEntrySha256: previousSha,
    decisions: freeze({ ...decisionCounts }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
