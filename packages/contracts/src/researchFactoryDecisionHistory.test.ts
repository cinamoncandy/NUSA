import test from "node:test";
import assert from "node:assert/strict";
import { decideResearchFactoryOutcome, type ResearchFactoryEvidence } from "./researchFactoryOutcome";
import {
  appendResearchFactoryDecisionHistory,
  emptyResearchFactoryDecisionHistory,
} from "./researchFactoryDecisionHistory";

const passEvidence: ResearchFactoryEvidence = {
  provenanceIntegrity: "PASS",
  costEvidence: "PASS",
  outOfSampleEvidence: "PASS",
  multipleTestingControl: "PASS",
  regimeRobustness: "PASS",
  sensitivityAndStress: "PASS",
  denominatorIntegrity: "PASS",
  replayDeterminism: "PASS",
};

function decision(evaluationId: string, evidence: ResearchFactoryEvidence) {
  return decideResearchFactoryOutcome({ candidateId: "cand-1", evaluationId, evidence });
}

test("retains rejected, insufficient and qualified decisions in denominator", () => {
  let history = emptyResearchFactoryDecisionHistory();
  history = appendResearchFactoryDecisionHistory({ history, decision: decision("eval-rejected", { ...passEvidence, costEvidence: "FAIL" }), observedAt: 1 }).history;
  history = appendResearchFactoryDecisionHistory({ history, decision: decision("eval-insufficient", { ...passEvidence, regimeRobustness: "UNKNOWN" }), observedAt: 2 }).history;
  history = appendResearchFactoryDecisionHistory({ history, decision: decision("eval-qualified", passEvidence), observedAt: 3 }).history;

  assert.equal(history.totalDecisions, 3);
  assert.equal(history.rejected, 1);
  assert.equal(history.insufficient, 1);
  assert.equal(history.qualifiedForLeague, 1);
  assert.deepEqual(history.records.map((record) => record.evaluationId), ["eval-rejected", "eval-insufficient", "eval-qualified"]);
});

test("exact replay is idempotent and does not inflate denominator", () => {
  const canonical = decision("eval-1", passEvidence);
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: canonical, observedAt: 10 });
  const replay = appendResearchFactoryDecisionHistory({ history: first.history, decision: canonical, observedAt: 10 });
  assert.equal(first.appended, true);
  assert.equal(replay.appended, false);
  assert.equal(replay.history, first.history);
  assert.equal(replay.history.totalDecisions, 1);
});

test("same evaluation id with changed decision content fails closed", () => {
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: decision("eval-1", passEvidence), observedAt: 10 });
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: first.history, decision: decision("eval-1", { ...passEvidence, outOfSampleEvidence: "FAIL" }), observedAt: 10 }), /RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH/);
});

test("same evaluation id with changed observation time fails closed", () => {
  const canonical = decision("eval-1", passEvidence);
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: canonical, observedAt: 10 });
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: first.history, decision: canonical, observedAt: 11 }), /RESEARCH_FACTORY_HISTORY_REPLAY_MISMATCH/);
});

test("authority escalation cannot enter research decision history", () => {
  const forged = { ...decision("eval-1", passEvidence), liveAuthority: "ENABLED" } as unknown as ReturnType<typeof decision>;
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: forged, observedAt: 1 }), /RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID/);
});

test("forged denominator counts fail closed", () => {
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: decision("eval-1", passEvidence), observedAt: 1 });
  const forged = { ...first.history, totalDecisions: 0 };
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: forged, decision: decision("eval-2", passEvidence), observedAt: 2 }), /RESEARCH_FACTORY_HISTORY_COUNT_MISMATCH/);
});

test("duplicate evaluation ids already present in history fail closed", () => {
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: decision("eval-1", passEvidence), observedAt: 1 });
  const duplicate = { ...first.history, records: [first.history.records[0], first.history.records[0]], totalDecisions: 2, qualifiedForLeague: 2 };
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: duplicate, decision: decision("eval-2", passEvidence), observedAt: 2 }), /RESEARCH_FACTORY_HISTORY_DUPLICATE_EVALUATION/);
});

test("forged authority inside existing history fails closed", () => {
  const first = appendResearchFactoryDecisionHistory({ history: emptyResearchFactoryDecisionHistory(), decision: decision("eval-1", passEvidence), observedAt: 1 });
  const forged = { ...first.history, records: [{ ...first.history.records[0], aiAuthority: "FULL_AUTHORITY" }] } as unknown as typeof first.history;
  assert.throws(() => appendResearchFactoryDecisionHistory({ history: forged, decision: decision("eval-2", passEvidence), observedAt: 2 }), /RESEARCH_FACTORY_HISTORY_AUTHORITY_INVALID/);
});
