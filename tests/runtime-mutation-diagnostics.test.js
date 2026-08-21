const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatRuntimeMutationDiagnostic,
  createPersistenceMutationFailedDiagnostic,
  createPersistenceRollbackCompletedDiagnostic,
  createPersistenceRollbackFailedDiagnostic,
  createPaperTradingDisabledDiagnostic,
  createAutomaticExecutionBlockedDiagnostic
} = require("../dist/apps/desktop/src/risk/runtimeMutationDiagnostics.js");

const LOG_PREFIX = "[NUSA_DESKTOP] ";

function parseFormatted(diagnostic) {
  const formatted = formatRuntimeMutationDiagnostic(diagnostic);
  assert.equal(formatted.startsWith(LOG_PREFIX), true, `expected the greppable ${LOG_PREFIX}prefix`);
  assert.equal(formatted.includes("\n"), false, "expected exactly one line per event");
  return JSON.parse(formatted.slice(LOG_PREFIX.length));
}

test("PERSISTENCE_MUTATION_FAILED records the mutation name", () => {
  const diagnostic = createPersistenceMutationFailedDiagnostic({ mutationName: "manual paper order" }, 1_000);
  assert.equal(diagnostic.kind, "PERSISTENCE_MUTATION_FAILED");
  assert.equal(diagnostic.timestamp, 1_000);
  assert.match(diagnostic.message, /manual paper order/);
  assert.equal(diagnostic.details.mutationName, "manual paper order");
});

test("PERSISTENCE_ROLLBACK_COMPLETED reports rollbackSucceeded true", () => {
  const diagnostic = createPersistenceRollbackCompletedDiagnostic({ mutationName: "control auto" }, 2_000);
  assert.equal(diagnostic.kind, "PERSISTENCE_ROLLBACK_COMPLETED");
  assert.equal(diagnostic.details.rollbackSucceeded, true);
  assert.equal(diagnostic.details.mutationName, "control auto");
});

test("PERSISTENCE_ROLLBACK_FAILED reports rollbackSucceeded false and a sanitized, single-line restore error", () => {
  const multilineError = "TypeError: cannot read state\n    at restoreState (/app/dist/apps/desktop/src/paper/paperBroker.js:1:1)";
  const diagnostic = createPersistenceRollbackFailedDiagnostic({ mutationName: "automatic signal", restoreErrorMessage: multilineError }, 3_000);
  assert.equal(diagnostic.kind, "PERSISTENCE_ROLLBACK_FAILED");
  assert.equal(diagnostic.details.rollbackSucceeded, false);
  assert.equal(diagnostic.details.restoreErrorMessage, "TypeError: cannot read state");
  assert.equal(diagnostic.details.restoreErrorMessage.includes("\n"), false);
});

test("PAPER_TRADING_DISABLED reports paperTradingAvailable and automaticTradingEnabled as false, plus the control status", () => {
  const diagnostic = createPaperTradingDisabledDiagnostic({ mutationName: "control stop", controlStatus: "FAULTED" }, 4_000);
  assert.equal(diagnostic.kind, "PAPER_TRADING_DISABLED");
  assert.equal(diagnostic.details.paperTradingAvailable, false);
  assert.equal(diagnostic.details.automaticTradingEnabled, false);
  assert.equal(diagnostic.details.controlStatus, "FAULTED");
});

test("AUTOMATIC_EXECUTION_BLOCKED reports automaticTradingEnabled as false", () => {
  const diagnostic = createAutomaticExecutionBlockedDiagnostic(5_000);
  assert.equal(diagnostic.kind, "AUTOMATIC_EXECUTION_BLOCKED");
  assert.equal(diagnostic.details.automaticTradingEnabled, false);
});

test("formatRuntimeMutationDiagnostic emits single-line, greppable JSON with no sensitive fields", () => {
  const parsed = parseFormatted(createPersistenceMutationFailedDiagnostic({ mutationName: "manual paper order" }, 6_000));
  assert.equal(parsed.kind, "PERSISTENCE_MUTATION_FAILED");
  assert.equal(parsed.timestamp, 6_000);
  assert.ok(parsed.details);
  assert.equal("apiKey" in parsed.details, false);
  assert.equal("password" in parsed.details, false);
});

test("every diagnostic builder is JSON-serializable end to end", () => {
  const diagnostics = [
    createPersistenceMutationFailedDiagnostic({ mutationName: "x" }),
    createPersistenceRollbackCompletedDiagnostic({ mutationName: "x" }),
    createPersistenceRollbackFailedDiagnostic({ mutationName: "x", restoreErrorMessage: "boom" }),
    createPaperTradingDisabledDiagnostic({ mutationName: "x", controlStatus: "FAULTED" }),
    createAutomaticExecutionBlockedDiagnostic()
  ];
  for (const diagnostic of diagnostics) {
    const parsed = JSON.parse(JSON.stringify(diagnostic));
    assert.equal(parsed.kind, diagnostic.kind);
  }
});
