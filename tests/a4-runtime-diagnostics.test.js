const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildA4RuntimeDiagnostics } = require("../dist/apps/desktop/src/diagnostics/a4RuntimeDiagnostics.js");

const diagnostic = (status = "PASS", blockers = []) => ({ status, method: "TEST", evidence: [], blockers });
const preflight = () => ({ deployment: diagnostic(), reconciliation: diagnostic(), riskGate: diagnostic() });
const shadow = (overrides = {}) => ({
  state: "IDLE", sessionId: null, symbol: "KRW-BTC", strategyId: "sma-crossover", marketDataStatus: "WARMING_UP",
  startedAt: null, elapsedMs: 0, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0,
  blockers: [], ...overrides
});

test("A4 diagnostics is read-only and reports readiness without leaking paths", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-a4-diagnostics-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await buildA4RuntimeDiagnostics({
    preflight: preflight(), shadow: shadow(), evidenceRoot: path.join(root, "evidence"), incompleteArchives: [],
    evidenceBus: null, startPrecheckBlockers: [],
    market: { connected: true, lastHeartbeatAt: 1, source: "UPBIT_PUBLIC_CLOSED_CANDLE" },
    safety: { killSwitchActive: false, openP0Count: 0, reasonCode: null },
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 }, generatedAt: 1
  });
  assert.equal(result.verdict, "READY_FOR_OBSERVATION");
  assert.equal(result.evidence.rootWritable, true);
  assert.equal(result.shadow.observationStarted, false);
  assert.deepEqual(result.mutationCounters, { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 });
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(fs.readdirSync(root).length, 0);
});

test("A4 diagnostics blocks unsafe states and preserves deterministic reason codes", async () => {
  const result = await buildA4RuntimeDiagnostics({
    preflight: { deployment: diagnostic("BLOCKED", ["DEPLOYMENT_MISMATCH"]), reconciliation: diagnostic(), riskGate: diagnostic() },
    shadow: shadow({ state: "RUNNING", sessionId: "session-1", blockers: ["EVIDENCE_RECOVERY_REQUIRED"] }),
    evidenceRoot: path.join(os.tmpdir(), "nusa-a4-missing-root"), incompleteArchives: ["UNREADABLE_SHADOW_EVIDENCE"],
    evidenceBus: { status: "HALTED", haltReason: "QUEUE_OVERFLOW", haltDetail: "secret/path must not be returned", published: 1, delivered: 0, duplicatesDropped: 0, queueDepth: 1, queueCapacity: 1, highWaterMark: 1, finalized: false },
    startPrecheckBlockers: ["DEPLOYMENT_MISMATCH"],
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 1, position: 0 }, generatedAt: 2
  });
  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.blockers, ["DEPLOYMENT_MISMATCH", "CASH_MUTATION:1", "EVIDENCE_BUS_QUEUE_OVERFLOW", "MARKERLESS_ARCHIVE_PRESENT", "RECOVERY_REQUIRED", "SHADOW_SESSION_NOT_IDLE"]);
  assert.equal(JSON.stringify(result).includes("secret/path"), false);
});

test("A4 diagnostics uses the exact Shadow start blocker order", async () => {
  const result = await buildA4RuntimeDiagnostics({
    preflight: preflight(), shadow: shadow({ marketDataStatus: "CONNECTING" }),
    evidenceRoot: path.join(os.tmpdir(), "nusa-a4-precheck"), incompleteArchives: [], evidenceBus: null,
    startPrecheckBlockers: ["MARKET_DATA_DISCONNECTED", "KILL_SWITCH_ACTIVE", "OPEN_P0_ALERT"],
    safety: { killSwitchActive: true, openP0Count: 1, reasonCode: "RUNTIME_FAULT" },
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 }, generatedAt: 100
  });
  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(result.startPrecheckBlockers, ["MARKET_DATA_DISCONNECTED", "KILL_SWITCH_ACTIVE", "OPEN_P0_ALERT"]);
  assert.deepEqual(result.blockers.slice(0, 3), result.startPrecheckBlockers);
  assert.equal(result.market.connected, false);
  assert.equal(result.market.fresh, false);
  assert.equal(result.safety.openP0Count, 1);
});

test("A4 diagnostics does not start, reset, dismiss, or delete runtime state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "diagnostics", "a4RuntimeDiagnostics.ts"), "utf8");
  assert.doesNotMatch(source, /shadow\.start\s*\(|killSwitch\.(reset|disable)\s*\(|alert\.(delete|dismiss)\s*\(/);
});
