// Proves the thing the cloud port exists to prove: an EMERGENCY_STOP accepted into the cloud
// control audit ledger (apps/cloud/src/controlAuditLedger.ts) actually reaches the ported risk
// gate and blocks it -- not just that the ledger records the event.
//
// Before this wiring, cloud had a ledger that could RECORD "EMERGENCY_STOP" and a risk gate
// that had never heard of it: nothing downstream ever read killSwitchActive, so the record was
// inert. This test builds the real call chain (readPaperEngineControlState(records, p0Records) ->
// getControl() -> createOperationalPaperRiskGate -> evaluatePreTradeRisk) against a live
// PaperBroker, and shows appending exactly one EMERGENCY_STOP event flips the gate from ALLOW
// to HALT/KILL_SWITCH_ACTIVE -- synchronously, in the same process, not "eventually".
//
// The gate is exercised with path "SHADOW", matching the existing convention in
// tests/paper-operational-preflight.test.js: createOperationalPaperRiskGate's approvalState is
// only satisfied for that path (approved: command.path === "SHADOW"), so MANUAL/STRATEGY paths
// always fail on APPROVAL_MISSING independent of kill-switch state -- a pre-existing property
// of the ported gate, faithfully reproduced from desktop, not something this port introduces or
// changes. Using SHADOW isolates the kill-switch effect from that unrelated approval gate. The
// same gate instance is also wired into a real RuntimeCommandService below to prove it is the
// actual production call path, not a standalone fixture.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/cloud/src/paperBroker.js");
const { ControlPlane } = require("../dist/apps/cloud/src/controlPlane.js");
const { RuntimeCommandService } = require("../dist/apps/cloud/src/runtimeCommandService.js");
const { createOperationalPaperRiskGate } = require("../dist/apps/cloud/src/paperOperationalPreflight.js");
const { createSessionPeakEquityTracker } = require("../dist/apps/cloud/src/paperRiskState.js");
const { appendControlAuditEvent } = require("../dist/apps/cloud/src/controlAuditLedger.js");
const { readPaperEngineControlState } = require("../dist/apps/cloud/src/paperEngineControlState.js");

const PASS = Object.freeze({ status: "PASS", method: "TEST_FIXTURE", evidence: Object.freeze([]), blockers: Object.freeze([]) });
const preflightState = Object.freeze({ deployment: PASS, reconciliation: PASS, riskGate: PASS });

const IDENTITY = Object.freeze({
  strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "p",
  seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set()
});
const LIMITS = Object.freeze({
  maxOrderNotional: 1_000_000, maxPositionNotional: 1_000_000, maxOpenOrders: 100,
  maxOrdersPerSecond: 100, maxOrdersPerMinute: 1000, maxSameSideStreak: 100,
  maxSymbolExposureNotional: 1_000_000, maxPortfolioExposureNotional: 1_000_000,
  maxDailyBuyNotional: 1_000_000, maxDailySellNotional: 1_000_000, maxDailyLoss: 1_000_000,
  maxConsecutiveLosses: 100, maxSessionDrawdownRatio: 1, maxPriceDeviationRatio: 1
});

function buildEngine() {
  let auditRecords = [];
  const p0Records = [];
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("sma-crossover");
  const strategy = { start() {}, stop() {}, isRunning: () => false, getStrategyId: () => "sma-crossover", restoreRunning() {} };
  const riskGate = createOperationalPaperRiskGate({
    getState: () => preflightState,
    getBroker: () => broker,
    getMarket: () => ({ symbol: "KRW-BTC", price: 50_000_000, status: "HEALTHY" }),
    // Both safety inputs are explicit: this legacy kill-switch test has no P0 incidents,
    // so it passes a real empty P0 ledger rather than relying on an implicit default.
    getControl: () => readPaperEngineControlState(auditRecords, p0Records),
    identity: IDENTITY,
    limits: LIMITS,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    sourceCommitSha: "test-commit",
    sessionPeakEquity: createSessionPeakEquityTracker(10_000_000)
  });
  // Wired into a real RuntimeCommandService, exactly as main.ts wires the equivalent desktop
  // gate into the app's actual order path -- this is the production composition, not a mock.
  const service = new RuntimeCommandService(broker, control, strategy, { save() {} }, riskGate);
  return {
    service,
    riskGate,
    triggerEmergencyStop() {
      auditRecords = appendControlAuditEvent(auditRecords, {
        commandId: `stop-${auditRecords.length + 1}`,
        userId: "owner-1",
        deviceId: "mobile-1",
        type: "EMERGENCY_STOP",
        status: "ACCEPTED",
        decidedAt: Date.now(),
        reason: "test-triggered emergency stop",
        resultingMode: "STOPPED",
        cancelOpenOrders: true
      });
    }
  };
}

test("before any EMERGENCY_STOP, the gate allows an order", () => {
  const { riskGate } = buildEngine();
  const decision = riskGate.evaluate({ path: "SHADOW", side: "BUY", quantity: 0.001, price: 50_000_000 });
  assert.equal(decision.status, "ALLOW");
});

test("an EMERGENCY_STOP accepted into the ledger blocks the very next order evaluation", () => {
  const { riskGate, triggerEmergencyStop } = buildEngine();
  assert.equal(riskGate.evaluate({ path: "SHADOW", side: "BUY", quantity: 0.001, price: 50_000_000 }).status, "ALLOW");
  triggerEmergencyStop();
  const decision = riskGate.evaluate({ path: "SHADOW", side: "BUY", quantity: 0.001, price: 50_000_000 });
  assert.equal(decision.status, "HALT");
  assert.ok(decision.reasonCodes.includes("KILL_SWITCH_ACTIVE"), `expected KILL_SWITCH_ACTIVE, got ${JSON.stringify(decision.reasonCodes)}`);
});

test("the block is read fresh from the ledger on every evaluation, not cached at gate construction", () => {
  const { riskGate, triggerEmergencyStop } = buildEngine();
  riskGate.evaluate({ path: "SHADOW", side: "BUY", quantity: 0.001, price: 50_000_000 });
  triggerEmergencyStop();
  assert.equal(riskGate.evaluate({ path: "SHADOW", side: "BUY", quantity: 0.001, price: 50_000_000 }).status, "HALT");
  assert.equal(riskGate.evaluate({ path: "SHADOW", side: "SELL", quantity: 0.0001, price: 50_000_000 }).status, "HALT");
});

test("RuntimeCommandService is wired to the same ledger-backed gate: manual orders still reach it (rejected here on the unrelated, pre-existing approval-window check, not silently bypassing the gate)", () => {
  const { service } = buildEngine();
  // This gate's approvalState is only satisfied for path SHADOW (see file header) -- MANUAL
  // always halts on APPROVAL_MISSING, a pre-existing property carried over unchanged from
  // desktop. What this proves is that manualOrder() reaches requireRiskApproval() ->
  // riskGate.evaluate() at all, i.e. the composition is real, not that this specific path is
  // approved.
  assert.throws(() => service.manualOrder("BUY", 0.001, 50_000_000), /paper risk HALT:.*APPROVAL_MISSING/);
});

test("without the ledger-backed wiring, an EMERGENCY_STOP in the ledger alone would not block anything -- readPaperEngineControlState is what closes that gap", () => {
  const records = [];
  const p0Records = [];
  assert.equal(readPaperEngineControlState(records, p0Records).killSwitchActive, false);
  const withStop = appendControlAuditEvent(records, {
    commandId: "stop-1", userId: "u", deviceId: "d", type: "EMERGENCY_STOP", status: "ACCEPTED",
    decidedAt: 1, reason: "r", resultingMode: "STOPPED", cancelOpenOrders: true
  });
  assert.equal(readPaperEngineControlState(withStop, p0Records).killSwitchActive, true);
});
