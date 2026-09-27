import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClosedLearningCycleResult } from "../closedLearningLoopCoordinator";
import type { PaperPerformanceFromLedgerResult } from "../paperPerformanceFromLedger";
import {
  JevPaperLearningEvaluationShadowObserver,
  buildJevPaperLearningEvaluationShadowInput,
  validateJevPaperLearningModelOutput,
} from "./jevPaperLearningEvaluationShadow";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function performance(patch: Partial<PaperPerformanceFromLedgerResult["evidence"]> = {}): PaperPerformanceFromLedgerResult {
  const evidence = Object.freeze({
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
    ...patch,
  });
  return Object.freeze({
    evidence,
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
      ledgerFingerprintSha256: evidence.sourceLedgerFingerprintSha256,
    }),
    canonicalOutcomeReceiptFingerprint: HASH_C,
  });
}

function cycle(): ClosedLearningCycleResult {
  return Object.freeze({
    status: "EXECUTED" as const,
    record: Object.freeze({
      cycleId: "closed-learning:cycle-1",
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
  });
}

const enabledEnv = { NUSA_JEV_PAPER_LEARNING_SHADOW_ENABLED: "true" };

describe("Jev PAPER learning evaluation shadow", () => {
  it("builds metadata-only READY input without canonical performance metrics", () => {
    const input = buildJevPaperLearningEvaluationShadowInput(
      { periodId: "period-1", performance: performance(), cycle: cycle() },
      { nowMs: () => 5_000, maxEvidenceAgeMs: 10_000, stalledAfterMs: 1_000 },
    );
    assert.equal(input.evidence.deterministicReadiness, "READY");
    assert.equal(input.evaluation.evaluated, true);
    assert.equal(input.evaluation.stalledByPolicy, false);
    const serialized = JSON.stringify(input);
    for (const forbidden of ["netPnL", "realizedPnL", "unrealizedPnL", "returnRate", "maxDrawdownRate", "feeAmount", "initialEquity", "finalEquity"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must never be sent to Jev`);
    }
    assert.equal(input.authority, "PAPER_ONLY");
    assert.equal(input.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(input.usableForRouting, false);
  });

  it("returns deterministic disabled fallback without provider calls", async () => {
    let calls = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async () => { calls += 1; return {}; },
      { nowMs: () => 5_000, nowIso: () => "2026-09-27T03:00:00.000Z" },
    );
    const receipt = await observer.observe({ periodId: "period-1", performance: performance(), cycle: cycle() }, {});
    assert.equal(receipt.fallbackApplied, true);
    assert.equal(receipt.reasonCode, "DISABLED");
    assert.equal(receipt.selectedReadiness, "READY");
    assert.equal(receipt.requiredModel, "HUMAN");
    assert.equal(calls, 0);
  });

  it("classifies NO_EVIDENCE without spending a provider call", async () => {
    let calls = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async () => { calls += 1; return {}; },
      { nowMs: () => 5_000, nowIso: () => "2026-09-27T03:00:00.000Z" },
    );
    const receipt = await observer.observe({ periodId: "period-1", performance: null }, enabledEnv);
    assert.equal(receipt.deterministicReadiness, "NO_EVIDENCE");
    assert.equal(receipt.reasonCode, "NO_EVIDENCE");
    assert.equal(receipt.fallbackApplied, true);
    assert.equal(calls, 0);
  });

  it("classifies stale and invalid inputs deterministically without provider calls", async () => {
    let calls = 0;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async () => { calls += 1; return {}; },
      {
        nowMs: () => 20_000,
        nowIso: () => "2026-09-27T03:00:00.000Z",
        maxEvidenceAgeMs: 1_000,
      },
    );
    const stale = await observer.observe({ periodId: "period-1", performance: performance() }, enabledEnv);
    assert.equal(stale.deterministicReadiness, "STALE");
    assert.equal(stale.reasonCode, "STALE_EVIDENCE");

    const invalid = await observer.observe({
      periodId: "period-2",
      performance: performance(),
      sourceFailureReason: "PAPER_PERFORMANCE_OUTCOME_RECEIPT_MISMATCH",
    }, enabledEnv);
    assert.equal(invalid.deterministicReadiness, "INVALID");
    assert.equal(invalid.reasonCode, "INVALID_EVIDENCE");
    assert.equal(calls, 0);
  });

  it("marks ready evidence stalled by deterministic policy when no evaluation consumed it", () => {
    const input = buildJevPaperLearningEvaluationShadowInput(
      { periodId: "period-1", performance: performance(), cycle: null },
      { nowMs: () => 10_000, maxEvidenceAgeMs: 20_000, stalledAfterMs: 5_000 },
    );
    assert.equal(input.evidence.deterministicReadiness, "READY");
    assert.equal(input.evaluation.evaluated, false);
    assert.equal(input.evaluation.stalledByPolicy, true);
  });

  it("records a valid Jev shadow classification without granting authority", async () => {
    let captured: Readonly<Record<string, unknown>> | undefined;
    const observer = new JevPaperLearningEvaluationShadowObserver(
      async (input) => {
        captured = input;
        return {
          readiness: "READY",
          stalled: false,
          requiredModel: "LUNA",
          reasonCode: "READY_FOR_REVIEW",
          confidence: 0.94,
        };
      },
      {
        minConfidence: 0.8,
        nowMs: () => 5_000,
        nowIso: () => "2026-09-27T03:00:00.000Z",
        modelIdentity: "jev-test",
      },
    );
    const receipt = await observer.observe(
      { periodId: "period-1", performance: performance(), cycle: cycle() },
      enabledEnv,
    );
    assert.equal(receipt.fallbackApplied, false);
    assert.equal(receipt.selectedReadiness, "READY");
    assert.equal(receipt.requiredModel, "LUNA");
    assert.equal(receipt.confidence, 0.94);
    assert.equal(receipt.shadow, true);
    assert.equal(receipt.usableForRouting, false);
    assert.equal(receipt.canonicalMetricsCalculated, false);
    assert.equal(receipt.canonicalEvidenceMutated, false);
    assert.equal(receipt.productionMutationAllowed, false);
    assert.equal(receipt.liveAuthority, "NONE");
    assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
    assert.ok(captured);
  });

  it("falls back on low confidence, malformed output, and provider failure", async () => {
    for (const classify of [
      async () => ({ readiness: "READY", stalled: false, requiredModel: "LUNA", reasonCode: "LOW", confidence: 0.2 }),
      async () => ({ readiness: "READY" }),
      async () => { throw Object.assign(new Error("down"), { name: "JevProviderUnavailableError" }); },
    ]) {
      const observer = new JevPaperLearningEvaluationShadowObserver(
        classify,
        {
          minConfidence: 0.8,
          nowMs: () => 5_000,
          nowIso: () => "2026-09-27T03:00:00.000Z",
        },
      );
      const receipt = await observer.observe(
        { periodId: "period-1", performance: performance(), cycle: cycle() },
        enabledEnv,
      );
      assert.equal(receipt.fallbackApplied, true);
      assert.equal(receipt.requiredModel, "HUMAN");
      assert.equal(receipt.usableForRouting, false);
    }
  });

  it("has deterministic replay identity for the same canonical evidence", async () => {
    const classify = async () => ({
      readiness: "READY",
      stalled: false,
      requiredModel: "LUNA",
      reasonCode: "READY_FOR_REVIEW",
      confidence: 0.95,
    });
    const options = {
      nowMs: () => 5_000,
      nowIso: () => "2026-09-27T03:00:00.000Z",
    };
    const first = await new JevPaperLearningEvaluationShadowObserver(classify, options)
      .observe({ periodId: "period-1", performance: performance(), cycle: cycle() }, enabledEnv);
    const second = await new JevPaperLearningEvaluationShadowObserver(classify, options)
      .observe({ periodId: "period-1", performance: performance(), cycle: cycle() }, enabledEnv);
    assert.equal(first.decisionId, second.decisionId);
    assert.equal(first.inputHash, second.inputHash);
  });

  it("strictly validates the bounded model output schema", () => {
    assert.deepEqual(
      validateJevPaperLearningModelOutput({
        readiness: "INSUFFICIENT",
        stalled: true,
        requiredModel: "SOL",
        reasonCode: "MORE_EVIDENCE",
        confidence: 0.88,
      }),
      {
        readiness: "INSUFFICIENT",
        stalled: true,
        requiredModel: "SOL",
        reasonCode: "MORE_EVIDENCE",
        confidence: 0.88,
      },
    );
    assert.throws(
      () => validateJevPaperLearningModelOutput({
        readiness: "READY",
        stalled: false,
        requiredModel: "JEV",
        reasonCode: "BAD",
        confidence: 1,
      }),
      /required model invalid/,
    );
  });
});
