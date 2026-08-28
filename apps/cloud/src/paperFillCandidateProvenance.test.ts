import assert from "node:assert/strict";
import test from "node:test";
import { PaperTradingExecutionLoop, type PaperAccountRepository, type PaperAccountState } from "./paperTradingExecutionLoop";
import type { CioDecision, PaperCandidateExecutionBinding } from "./cioDecisionEngine";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function binding(): PaperCandidateExecutionBinding {
  return Object.freeze({
    schemaVersion: 1,
    status: "BOUND_UNVERIFIED",
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    candidateId: "candidate-alpha",
    datasetId: "dataset-2026-08-28",
    datasetContentSha256: SHA_A,
    advisoryGeneratedAt: 1_000,
    periodStartAt: 2_000,
    advisoryFingerprintSha256: SHA_B,
    bindingFingerprintSha256: SHA_C,
  });
}

function decision(candidateBinding?: PaperCandidateExecutionBinding): CioDecision {
  return Object.freeze({
    symbol: "KRW-BTC",
    action: "BUY",
    confidence: 0.9,
    risk: "LOW",
    allocation: 0.1,
    leverage: 1,
    score: 0.8,
    reasons: Object.freeze(["test"]),
    decidedAt: 3_000,
    ...(candidateBinding == null ? {} : { paperCandidateBinding: candidateBinding }),
  });
}

function tick(decisions: readonly CioDecision[]) {
  return {
    now: 4_000,
    market: "KRW-BTC",
    price: 100,
    quantity: 1,
    observedAt: 3_900,
    mode: "PAPER" as const,
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY" as const,
    decisions,
    investmentPercent: 100,
  };
}

class CapturingRepository implements PaperAccountRepository {
  public saved?: PaperAccountState;
  public save(state: PaperAccountState): void { this.saved = state; }
  public loadLatest(): PaperAccountState | undefined { return undefined; }
  public clear(): void { this.saved = undefined; }
}

test("canonical strategy fill persists the exact candidate binding from its CIO decision", () => {
  const repository = new CapturingRepository();
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000, repository });
  const expected = binding();
  const result = loop.processTick(tick([decision(expected)]));

  assert.equal(result.status, "FILLED");
  assert.equal(result.fills.length, 1);
  assert.deepEqual(result.fills[0]?.candidateProvenance, {
    schemaVersion: 1,
    source: "CIO_DECISION_BINDING",
    decisionAt: 3_000,
    binding: expected,
  });
  assert.deepEqual(repository.saved?.fills[0]?.candidateProvenance, result.fills[0]?.candidateProvenance);
  assert.equal(result.fills[0]?.candidateProvenance?.binding.liveAuthority, "NONE");
  assert.equal(result.fills[0]?.candidateProvenance?.binding.productionMutationAllowed, false);
});

test("unbound strategy fills remain explicitly unattributed and therefore non-promotable", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000 });
  const result = loop.processTick(tick([decision()]));
  assert.equal(result.status, "FILLED");
  assert.equal(result.fills[0]?.candidateProvenance, undefined);
});

test("restored canonical state rejects mutated candidate provenance fail closed", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000 });
  const result = loop.processTick(tick([decision(binding())]));
  assert.equal(result.status, "FILLED");
  const fill = result.state.fills[0]!;
  const corrupted: PaperAccountState = {
    ...result.state,
    fills: [{
      ...fill,
      candidateProvenance: {
        ...fill.candidateProvenance!,
        binding: { ...fill.candidateProvenance!.binding, candidateId: "CIO_PAPER" },
      },
    }],
  };
  assert.throws(() => new PaperTradingExecutionLoop({ initialCapital: 10_000, restoredState: corrupted }), /candidateId is invalid/);
});
