const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { selectPaperLedgerRecoveryCandidate, validatePaperLedgerRecovery } = require("../dist/apps/desktop/src/paperLedgerValidation.js");
const { PERSISTENCE_REPAIR_MESSAGE, RuntimeCommandService } = require("../dist/apps/desktop/src/runtimeCommandService.js");
const { SmaCrossoverStrategy, StrategyEngine } = require("../dist/apps/desktop/src/strategyEngine.js");

const INITIAL_CASH = 10_000;
const clone = (value) => JSON.parse(JSON.stringify(value));

function validState() {
  const broker = new PaperBroker(INITIAL_CASH, "KRW-BTC", 0);
  broker.execute("BUY", 1, 100, new Date("2026-01-01T00:00:01.000Z"));
  broker.execute("SELL", 0.4, 120, new Date("2026-01-01T00:00:02.000Z"));
  return broker.exportState();
}

function invalidState(mutate) {
  const state = clone(validState());
  mutate(state);
  return state;
}

test("valid Ledger recovery preserves the existing PaperBroker projection", () => {
  const state = validState();
  assert.deepEqual(validatePaperLedgerRecovery(state, INITIAL_CASH), { status: "VALID", reasonCodes: [] });
  assert.deepEqual(new PaperBroker(INITIAL_CASH, "KRW-BTC", 0, {}, state).exportState(), state);
});

for (const [reasonCode, mutate] of [
  ["INVALID_SEQUENCE", (state) => { state.ledger[0].sequence = 0; }],
  ["DUPLICATE_SEQUENCE", (state) => { state.ledger[1].sequence = state.ledger[0].sequence; }],
  ["INVALID_ORDER_REFERENCE", (state) => { state.ledger[0].orderId = "missing-order"; }],
  ["NEGATIVE_CASH", (state) => { state.ledger[0].cashAfter = -1; }],
  ["NEGATIVE_POSITION", (state) => { state.ledger[0].positionQuantityAfter = -1; }],
  ["INVALID_AVERAGE_PRICE", (state) => { state.position.averagePrice = 0; }],
  ["TIMESTAMP_REGRESSION", (state) => {
    const entry = state.ledger[1];
    entry.occurredAt = "2026-01-01T00:00:00.000Z";
    state.orders.find((order) => order.id === entry.orderId).filledAt = entry.occurredAt;
  }],
  ["PROJECTION_MISMATCH", (state) => { state.cash += 1; }],
  ["LEDGER_TRANSITION_MISMATCH", (state) => { state.ledger[0].cashAfter += 1; }],
  ["SELL_EXCEEDS_POSITION", (state) => {
    const entry = state.ledger[1];
    entry.quantity = 2;
    state.orders.find((order) => order.id === entry.orderId).quantity = 2;
  }]
]) {
  test(`corrupted Ledger returns ${reasonCode}`, () => {
    const state = invalidState(mutate);
    const result = validatePaperLedgerRecovery(state, INITIAL_CASH);
    assert.equal(result.status, "INVALID");
    assert.ok(result.reasonCodes.includes(reasonCode), JSON.stringify(result));
    assert.throws(() => new PaperBroker(INITIAL_CASH, "KRW-BTC", 0, {}, state), /paper ledger recovery validation failed/);
  });
}

test("SQLite remains the recovery priority, legacy is the validated fallback, and recovery failure rejects Paper commands", () => {
  const legacy = { paper: validState() };
  const sqlite = { paper: validState() };
  const sqlitePriority = selectPaperLedgerRecoveryCandidate(sqlite, { paper: invalidState((state) => { state.cash += 1; }) }, INITIAL_CASH);
  assert.equal(sqlitePriority.source, "SQLITE");
  assert.equal(sqlitePriority.validation.status, "VALID");
  const legacyFallback = selectPaperLedgerRecoveryCandidate(undefined, legacy, INITIAL_CASH);
  assert.equal(legacyFallback.source, "LEGACY");
  assert.equal(legacyFallback.validation.status, "VALID");
  const invalidSqlite = selectPaperLedgerRecoveryCandidate({ paper: invalidState((state) => { state.cash += 1; }) }, legacy, INITIAL_CASH);
  assert.equal(invalidSqlite.source, "SQLITE");
  assert.equal(invalidSqlite.validation.status, "INVALID");

  const main = fs.readFileSync(path.join(process.cwd(), "apps", "desktop", "src", "main.ts"), "utf8");
  const candidate = main.indexOf("selectPaperLedgerRecoveryCandidate(sqliteState, legacyState, INITIAL_CASH)");
  const validation = main.indexOf("if (validation.status === \"INVALID\")");
  const legacyImport = main.indexOf("persistenceStore.importLegacy(candidate)");
  assert.ok(candidate >= 0 && validation > candidate && legacyImport > validation);
  assert.match(main, /PAPER_LEDGER_VALIDATION:\$\{validation\.reasonCodes\.join\(","\)\}/);
  assert.match(main, /persistenceUserDiagnostic = PERSISTENCE_REPAIR_MESSAGE/);
  assert.match(main, /if \(!paperTradingAvailable\) paperCommandService\(\)\.markUnavailable\(\);/);

  const commands = new RuntimeCommandService(
    new PaperBroker(INITIAL_CASH, "KRW-BTC", 0),
    new ControlPlane("sma-crossover"),
    new StrategyEngine(new SmaCrossoverStrategy(2, 3)),
    { save() {} },
    { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) }
  );
  commands.markUnavailable();
  assert.throws(() => commands.manualOrder("BUY", 1, 100), new RegExp(PERSISTENCE_REPAIR_MESSAGE));
});
