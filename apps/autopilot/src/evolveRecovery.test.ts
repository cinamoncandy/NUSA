import assert from "node:assert/strict";
import test from "node:test";
import { decideEvolutionRecovery } from "./evolveRecovery";

test("bounds transient retries", () => {
  assert.equal(decideEvolutionRecovery({ failureClass: "KNOWN_TRANSIENT", attempts: 0, rollbackEvidence: false }).action, "RETRY");
  assert.equal(decideEvolutionRecovery({ failureClass: "KNOWN_TRANSIENT", attempts: 2, rollbackEvidence: false }).action, "ABSTAIN");
});

test("rolls back only with regression evidence", () => {
  assert.equal(decideEvolutionRecovery({ failureClass: "KNOWN_REGRESSION", attempts: 1, rollbackEvidence: true }).action, "ROLLBACK");
  assert.equal(decideEvolutionRecovery({ failureClass: "KNOWN_REGRESSION", attempts: 1, rollbackEvidence: false }).action, "ABSTAIN");
  assert.equal(decideEvolutionRecovery({ failureClass: "UNKNOWN", attempts: 0, rollbackEvidence: true }).action, "ABSTAIN");
});
