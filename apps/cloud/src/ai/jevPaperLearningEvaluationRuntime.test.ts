import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClosedLearningRolloverResult } from "../closedLearningRolloverScheduler";
import type { PaperPerformanceFromLedgerResult } from "../paperPerformanceFromLedger";
import { JevPaperLearningEvaluationShadowObserver } from "./jevPaperLearningEvaluationShadow";
import { observeJevPaperLearningAfterRollover } from "./jevPaperLearningEvaluationRuntime";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function performance(): PaperPerformanceFromLedgerResult {
  return Object.freeze({
    evidence: Object.freeze({
      schemaVersion: 1 as const,
      evidenceKind: "PAPER" as const,
      authority: "PAPER_ONLY" as const,
      liveAuthority: "NONE" as const,
      productionMutationAllowed: false as const,
      aiAuthority: "ZERO_AUTHORITY" as const,
      candidateId: "candidate-1",
      strategyId: "lineage-1",
      strategyVersion: "spec-1",
      periodStartAt: 1_000,
      periodEndAt: 4_000,
      observationCount: 4,
      initialEquity: 100,
      finalEquity: 110,
      netPnL: 10,
      realizedPnL: 8,
      unrealizedPnL: 2,
      returnRate: 0.1,
      maxDrawdownRate: 0.02,
      feeAmount: 1,
      fillCount: 2,
      sourceLedgerFingerprintSha256: HASH_A,
      benchmarkId: "KRW-BTC",
      calculationVersion: "paper-performance-v1",
      generatedAt: 4_000,
      evidenceFingerprintSha256: HASH_B,
    }),
    familyId: "family-1",
    ledgerSource: Object.freeze({
      durableCompleteJournal: true as const,
      reconciled: true as const,
      historyStartAt: 1_000,
      historyEndAt: 4_000,
      fills: Object.freeze([]),
      projection: Object.freeze({
        cash: 110,
        realizedPnL: 8,
        positions: Object.freeze([]),
        journal: Object.freeze([]),
        fingerprintSha256: HASH_C,
      }),
      ledgerFingerprintSha256: HASH_A,
    }),
    canonicalOutcomeReceiptFingerprint: HASH_C,
  });
}

function rollover(status: ClosedLearningRolloverResult["status"] = "CLOSED_AND_EVALUATED"): ClosedLearningRolloverResult {
  if (status !== "CLOSED_AND_EVALUATED") return Object.freeze({ status });
  return Object.freeze({
    status,
    periodId: "period-1",
    cycle: Object.freeze({
      status: "EXECUTED" as const,
      record: Object.freeze({
        cycleId: "cycle-1",
        evidenceId: "evidence-1",
        evidenceFingerprintSha256: HASH_B,
        decision: Object.freeze({
          decisionId: "decision-1",
          outcome: "INSUFFICIENT" as const,
          decisionReference: "research:decision-1",
          reasons: Object.freeze(["MORE_EVIDENCE_REQUIRED"]),
        }),
        recordedAt: 4_100,
      }),
    }),
  });
}

describe("Jev PAPER learning runtime bridge", () => {
  it("does nothing for non-evaluated rollover states", async () => {
    let reads = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(async () => {
      throw new Error("must not classify");
    });
    const result = await observeJevPaperLearningAfterRollover(rollover("NO_OPEN_PERIOD"), {
      observer,
      readPaperPerformanceEvidence: () => { reads += 1; return performance(); },
      env: { NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED: "true" },
    });
    assert.equal(result, null);
    assert.equal(reads, 0);
  });

  it("logs one metadata-only shadow receipt after canonical evaluation", async () => {
    const lines: string[] = [];
    let reads = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async () => ({
        readiness: "READY",
        stalled: false,
        requiredModel: "LUNA",
        reasonCode: "READY_FOR_REVIEW",
        confidence: 0.95,
      }),
      {
        nowMs: () => 5_000,
        nowIso: () => "2026-09-27T03:00:00.000Z",
      },
    );
    const receipt = await observeJevPaperLearningAfterRollover(rollover(), {
      observer,
      readPaperPerformanceEvidence: () => { reads += 1; return performance(); },
      env: { NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED: "true" },
      log: (line) => lines.push(line),
    });
    assert.ok(receipt);
    assert.equal(receipt?.selectedReadiness, "READY");
    assert.equal(receipt?.usableForRouting, false);
    assert.equal(receipt?.canonicalMetricsCalculated, false);
    assert.equal(reads, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /JEV_PAPER_LEARNING_EVALUATION_SHADOW/);
    assert.doesNotMatch(lines[0] ?? "", /netPnL|returnRate|maxDrawdownRate/);
  });

  it("converts canonical evidence-read failure into INVALID fallback without blocking the cycle", async () => {
    let classifyCalls = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async () => { classifyCalls += 1; return {}; },
      {
        nowMs: () => 5_000,
        nowIso: () => "2026-09-27T03:00:00.000Z",
      },
    );
    const receipt = await observeJevPaperLearningAfterRollover(rollover(), {
      observer,
      readPaperPerformanceEvidence: () => { throw new Error("PAPER_PERFORMANCE_OUTCOME_RECEIPT_MISMATCH"); },
      env: { NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED: "true" },
      log: () => undefined,
    });
    assert.ok(receipt);
    assert.equal(receipt?.deterministicReadiness, "INVALID");
    assert.equal(receipt?.reasonCode, "INVALID_EVIDENCE");
    assert.equal(receipt?.fallbackApplied, true);
    assert.equal(classifyCalls, 0);
  });

  it("contains unexpected observer failures and never mutates canonical rollover result", async () => {
    const original = rollover();
    const brokenObserver = {
      async observe() { throw new Error("unexpected"); },
    } as unknown as JevPaperLearningEvaluationShadowObserver;
    const result = await observeJevPaperLearningAfterRollover(original, {
      observer: brokenObserver,
      readPaperPerformanceEvidence: () => performance(),
      log: () => undefined,
    });
    assert.equal(result, null);
    assert.equal(original.status, "CLOSED_AND_EVALUATED");
    assert.equal(original.cycle?.record.decision.outcome, "INSUFFICIENT");
  });
});
