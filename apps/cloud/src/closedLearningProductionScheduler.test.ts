import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { ClosedLearningProductionScheduler } from "./closedLearningProductionScheduler";

const evidence: ClosedLearningEvidenceIdentity = Object.freeze({
  evidenceId: "paper-forward:test",
  evidenceFingerprintSha256: "a".repeat(64),
  championId: "champion-a",
  championVersion: "v1",
  sourceCommitSha: "1".repeat(40),
  costModelVersion: "cost-v1",
  riskConfigHash: "b".repeat(64),
  evidenceReferences: Object.freeze(["paper-period:record-1"]),
});

describe("ClosedLearningProductionScheduler", () => {
  it("does nothing before the minimum evidence source is ready", () => {
    let calls = 0;
    const scheduler = new ClosedLearningProductionScheduler({ evidence: { read: () => undefined }, coordinator: { run: () => { calls += 1; throw new Error("must not run"); } } });
    assert.equal(scheduler.runOnce(), undefined);
    assert.equal(calls, 0);
  });

  it("delegates replay identity to the coordinator without inventing a new cycle", () => {
    let seen: ClosedLearningEvidenceIdentity | undefined;
    const expected = Object.freeze({ status: "REPLAYED" as const, record: Object.freeze({ cycleId: `closed-learning:${"c".repeat(64)}`, evidenceId: evidence.evidenceId, evidenceFingerprintSha256: evidence.evidenceFingerprintSha256, decision: Object.freeze({ decisionId: "d1", outcome: "INSUFFICIENT" as const, decisionReference: "research:1", reasons: Object.freeze(["INSUFFICIENT"]) }), recordedAt: 1 }) });
    const scheduler = new ClosedLearningProductionScheduler({ evidence: { read: () => evidence }, coordinator: { run: (input) => { seen = input; return expected; } } });
    assert.equal(scheduler.runOnce(), expected);
    assert.equal(seen, evidence);
  });

  it("reports cycle failure without throwing into the trading runtime", () => {
    let reported = "";
    const scheduler = new ClosedLearningProductionScheduler({ evidence: { read: () => evidence }, coordinator: { run: () => { throw new Error("research unavailable"); } }, onError: (error) => { reported = error.message; } });
    assert.equal(scheduler.runOnce(), undefined);
    assert.equal(reported, "research unavailable");
  });
});
