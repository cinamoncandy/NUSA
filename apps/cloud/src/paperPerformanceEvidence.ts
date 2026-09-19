import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;
const round8 = (value: number): number => Number(value.toFixed(8));

export interface PaperPerformanceEvidenceInput {
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly peakEquity: number;
  readonly minimumEquity: number;
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

function assertInput(input: PaperPerformanceEvidenceInput): void {
  for (const [name, value] of [
    ["candidateId", input.candidateId],
    ["strategyId", input.strategyId],
    ["strategyVersion", input.strategyVersion],
  ] as const) if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`paper performance ${name} is invalid`);

  if (!Number.isSafeInteger(input.periodStartAt) || !Number.isSafeInteger(input.periodEndAt) || input.periodStartAt < 0 || input.periodEndAt < input.periodStartAt) throw new Error("paper performance period is invalid");
  for (const [name, value] of [
    ["initialEquity", input.initialEquity],
    ["finalEquity", input.finalEquity],
    ["peakEquity", input.peakEquity],
    ["minimumEquity", input.minimumEquity],
    ["realizedPnL", input.realizedPnL],
    ["unrealizedPnL", input.unrealizedPnL],
    ["feeAmount", input.feeAmount],
  ] as const) if (!Number.isFinite(value)) throw new Error(`paper performance ${name} must be finite`);

  if (input.initialEquity <= 0 || input.finalEquity < 0 || input.peakEquity <= 0 || input.minimumEquity < 0 || input.minimumEquity > input.peakEquity || input.finalEquity > input.peakEquity || input.feeAmount < 0) throw new Error("paper performance accounting bounds are invalid");
  if (!Number.isSafeInteger(input.fillCount) || input.fillCount < 0) throw new Error("paper performance fillCount is invalid");
  if (!SHA256.test(input.sourceLedgerFingerprintSha256)) throw new Error("paper performance ledger fingerprint is invalid");
}

function fingerprint(value: Omit<PaperPerformanceEvidence, "evidenceFingerprintSha256">): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildPaperPerformanceEvidence(input: PaperPerformanceEvidenceInput): PaperPerformanceEvidence {
  assertInput(input);
  const body = Object.freeze({
    schemaVersion: 1 as const,
    evidenceKind: "PAPER" as const,
    authority: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    candidateId: input.candidateId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    initialEquity: round8(input.initialEquity),
    finalEquity: round8(input.finalEquity),
    netPnL: round8(input.finalEquity - input.initialEquity),
    realizedPnL: round8(input.realizedPnL),
    unrealizedPnL: round8(input.unrealizedPnL),
    returnRate: round8((input.finalEquity - input.initialEquity) / input.initialEquity),
    maxDrawdownRate: round8((input.peakEquity - input.minimumEquity) / input.peakEquity),
    feeAmount: round8(input.feeAmount),
    fillCount: input.fillCount,
    sourceLedgerFingerprintSha256: input.sourceLedgerFingerprintSha256,
  });
  return Object.freeze({ ...body, evidenceFingerprintSha256: fingerprint(body) });
}

export function verifyPaperPerformanceEvidence(input: PaperPerformanceEvidenceInput, evidence: PaperPerformanceEvidence): void {
  const expected = buildPaperPerformanceEvidence(input);
  if (JSON.stringify(expected) !== JSON.stringify(evidence)) throw new Error("PAPER_PERFORMANCE_EVIDENCE_MISMATCH");
}
