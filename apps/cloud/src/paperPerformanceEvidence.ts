import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;
const round8 = (value: number): number => Number(value.toFixed(8));

export interface PaperEquityObservation {
  readonly observedAt: number;
  readonly equity: number;
}

export interface PaperPerformanceEvidenceInput {
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly equityCurve: readonly PaperEquityObservation[];
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly feeAmount: number;
  readonly fillCount: number;
  readonly sourceLedgerFingerprintSha256: string;
}

export interface PaperPerformanceEvidence {
  readonly schemaVersion: 1;
  readonly evidenceKind: "PAPER";
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly observationCount: number;
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly netPnL: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly returnRate: number;
  readonly maxDrawdownRate: number;
  readonly feeAmount: number;
  readonly fillCount: number;
  readonly sourceLedgerFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
}

function canonicalCurve(input: PaperPerformanceEvidenceInput): readonly PaperEquityObservation[] {
  if (!Array.isArray(input.equityCurve) || input.equityCurve.length < 2) throw new Error("PAPER_PERFORMANCE_INSUFFICIENT_OBSERVATIONS");
  let previousAt = -1;
  return Object.freeze(input.equityCurve.map((point) => {
    if (!Number.isSafeInteger(point.observedAt) || point.observedAt < input.periodStartAt || point.observedAt > input.periodEndAt || point.observedAt <= previousAt) throw new Error("paper performance equity observation time is invalid");
    if (!Number.isFinite(point.equity) || point.equity < 0) throw new Error("paper performance equity observation is invalid");
    previousAt = point.observedAt;
    return Object.freeze({ observedAt: point.observedAt, equity: round8(point.equity) });
  }));
}

function maxDrawdown(curve: readonly PaperEquityObservation[]): number {
  let peak = curve[0].equity;
  let maximum = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.equity) / peak);
  }
  return round8(maximum);
}

function assertInput(input: PaperPerformanceEvidenceInput): readonly PaperEquityObservation[] {
  for (const [name, value] of [["candidateId", input.candidateId], ["strategyId", input.strategyId], ["strategyVersion", input.strategyVersion]] as const) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`paper performance ${name} is invalid`);
  }
  if (!Number.isSafeInteger(input.periodStartAt) || !Number.isSafeInteger(input.periodEndAt) || input.periodStartAt < 0 || input.periodEndAt <= input.periodStartAt) throw new Error("paper performance period is invalid");
  for (const [name, value] of [["realizedPnL", input.realizedPnL], ["unrealizedPnL", input.unrealizedPnL], ["feeAmount", input.feeAmount]] as const) {
    if (!Number.isFinite(value)) throw new Error(`paper performance ${name} must be finite`);
  }
  if (input.feeAmount < 0) throw new Error("paper performance feeAmount is invalid");
  if (!Number.isSafeInteger(input.fillCount) || input.fillCount < 0) throw new Error("paper performance fillCount is invalid");
  if (!SHA256.test(input.sourceLedgerFingerprintSha256)) throw new Error("paper performance ledger fingerprint is invalid");
  const curve = canonicalCurve(input);
  if (curve[0].observedAt !== input.periodStartAt || curve.at(-1)!.observedAt !== input.periodEndAt || curve[0].equity <= 0) throw new Error("paper performance equity window is incomplete");
  return curve;
}

function fingerprint(value: Omit<PaperPerformanceEvidence, "evidenceFingerprintSha256">): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildPaperPerformanceEvidence(input: PaperPerformanceEvidenceInput): PaperPerformanceEvidence {
  const curve = assertInput(input);
  const initialEquity = curve[0].equity;
  const finalEquity = curve.at(-1)!.equity;
  const body = Object.freeze({
    schemaVersion: 1 as const, evidenceKind: "PAPER" as const, authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const,
    candidateId: input.candidateId, strategyId: input.strategyId, strategyVersion: input.strategyVersion,
    periodStartAt: input.periodStartAt, periodEndAt: input.periodEndAt, observationCount: curve.length,
    initialEquity, finalEquity, netPnL: round8(finalEquity - initialEquity),
    realizedPnL: round8(input.realizedPnL), unrealizedPnL: round8(input.unrealizedPnL),
    returnRate: round8((finalEquity - initialEquity) / initialEquity), maxDrawdownRate: maxDrawdown(curve),
    feeAmount: round8(input.feeAmount), fillCount: input.fillCount,
    sourceLedgerFingerprintSha256: input.sourceLedgerFingerprintSha256,
  });
  return Object.freeze({ ...body, evidenceFingerprintSha256: fingerprint(body) });
}

export function verifyPaperPerformanceEvidence(input: PaperPerformanceEvidenceInput, evidence: PaperPerformanceEvidence): void {
  const expected = buildPaperPerformanceEvidence(input);
  if (JSON.stringify(expected) !== JSON.stringify(evidence)) throw new Error("PAPER_PERFORMANCE_EVIDENCE_MISMATCH");
}
