const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { compareRecoveryState, approveRecoveryReview, completeRecovery, RecoveryReviewState } = require("../dist/apps/desktop/src/recovery/recoveryReconciliation.js");
const { parseRecoveryOwnerReviewIpc, parseRecoveryStatusIpc, parseRecoveryReconcileIpc, parseRecoveryCompleteIpc } = require("../dist/apps/desktop/src/ipc/recoveryIpcValidation.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "main.ts"), "utf8");
// The recovery:* IPC channels live in registerRecoveryIpcHandlers.ts, registered from main.ts.
const recoveryIpcSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "ipc", "registerRecoveryIpcHandlers.ts"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "preload.ts"), "utf8");
const CHECKED_AT = Date.UTC(2026, 6, 28, 6, 0, 0);
const INITIAL_CASH = 10_000_000;
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };

function freshBroker() {
  return new PaperBroker(INITIAL_CASH, "KRW-BTC", 0.0005, RISK_POLICY, undefined, { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 });
}

/** A comparison input in which every condition is already satisfied. Tests spoil one field. */
function healthyInput(overrides = {}) {
  return {
    recoveryRecordId: "snapshot-1",
    persistedSnapshotPresent: true,
    persistenceHealthy: true,
    broker: freshBroker(),
    initialCash: INITIAL_CASH,
    markPrice: 100_000_000,
    killSwitchActive: false,
    openP0Codes: [],
    markerlessEvidence: [],
    authenticatedEndpointCapabilityPresent: false,
    credentialStorageCapabilityPresent: false,
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 },
    checkedAt: CHECKED_AT,
    ...overrides
  };
}

test("1: a clean persisted snapshot reconciles as MATCHED", () => {
  const result = compareRecoveryState(healthyInput());
  assert.equal(result.outcome, "MATCHED", JSON.stringify({ m: result.mismatchCodes, e: result.errorCodes }));
  assert.deepEqual([...result.mismatchCodes], []);
  assert.deepEqual([...result.errorCodes], []);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.recoveryRecordId, "snapshot-1");
  assert.equal(result.checkedAt, CHECKED_AT);
});

test("2: an unresolved fill reconciles as MISMATCHED", () => {
  const broker = freshBroker();
  broker.execute("BUY", 0.001, 100_000_000, new Date(CHECKED_AT - 1_000));
  const state = broker.exportState();
  const tampered = { ...state, orders: state.orders.map((order) => ({ ...order, filledAt: "" })) };
  const result = compareRecoveryState(healthyInput({
    broker: new PaperBroker(INITIAL_CASH, "KRW-BTC", 0.0005, RISK_POLICY, tampered, { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 })
  }));
  assert.equal(result.outcome, "MISMATCHED");
  assert.ok(result.mismatchCodes.includes("UNRESOLVED_FILLS"), JSON.stringify(result.mismatchCodes));
});

test("3: persisted cash projection is rebuilt from the authoritative ledger", () => {
  const broker = freshBroker();
  broker.execute("BUY", 0.001, 100_000_000, new Date(CHECKED_AT - 1_000));
  const state = broker.exportState();
  const tampered = { ...state, cash: state.cash - 1_000 };
  const result = compareRecoveryState(healthyInput({
    broker: new PaperBroker(INITIAL_CASH, "KRW-BTC", 0.0005, RISK_POLICY, tampered, { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 })
  }));
  assert.equal(result.outcome, "MATCHED", JSON.stringify(result.mismatchCodes));
  assert.deepEqual([...result.mismatchCodes], []);
});

test("4: persisted position projection is rebuilt from the authoritative ledger", () => {
  const broker = freshBroker();
  broker.execute("BUY", 0.001, 100_000_000, new Date(CHECKED_AT - 1_000));
  const state = broker.exportState();
  const tampered = { ...state, position: { ...state.position, quantity: state.position.quantity + 0.5 } };
  const result = compareRecoveryState(healthyInput({
    broker: new PaperBroker(INITIAL_CASH, "KRW-BTC", 0.0005, RISK_POLICY, tampered, { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 })
  }));
  assert.equal(result.outcome, "MATCHED", JSON.stringify(result.mismatchCodes));
  assert.deepEqual([...result.mismatchCodes], []);
});

test("5: any non-zero mutation counter reconciles as MISMATCHED", () => {
  for (const [field, code] of [
    ["broker", "BROKER_MUTATION"], ["orders", "ORDER_MUTATION"], ["fills", "FILL_MUTATION"],
    ["cash", "CASH_MUTATION"], ["position", "POSITION_MUTATION"]
  ]) {
    const base = healthyInput();
    const result = compareRecoveryState({ ...base, mutationCounters: { ...base.mutationCounters, [field]: 1 } });
    assert.equal(result.outcome, "MISMATCHED", field);
    assert.ok(result.mismatchCodes.includes(code), `${field}: ${JSON.stringify(result.mismatchCodes)}`);
  }
});

test("5b: kill switch, open P0, markerless evidence and capability each reconcile as MISMATCHED", () => {
  const cases = [
    [{ killSwitchActive: true }, "KILL_SWITCH_ACTIVE"],
    [{ openP0Codes: ["P0_DATA_LOSS"] }, "UNRESOLVED_P0_ALERT"],
    [{ markerlessEvidence: ["/scratch/shadow-open"] }, "MARKERLESS_EVIDENCE"],
    [{ authenticatedEndpointCapabilityPresent: true }, "PRIVATE_API_CAPABILITY_PRESENT"],
    [{ credentialStorageCapabilityPresent: true }, "CREDENTIAL_CAPABILITY_PRESENT"]
  ];
  for (const [override, code] of cases) {
    const result = compareRecoveryState(healthyInput(override));
    assert.equal(result.outcome, "MISMATCHED", code);
    assert.ok(result.mismatchCodes.includes(code), JSON.stringify(result.mismatchCodes));
  }
});

test("6: a missing snapshot or unreadable state reconciles as ERROR, never MISMATCHED", () => {
  const cases = [
    [{ persistedSnapshotPresent: false }, "PERSISTED_SNAPSHOT_MISSING"],
    [{ recoveryRecordId: null }, "RECOVERY_RECORD_MISSING"],
    [{ broker: null }, "ACCOUNT_STATE_UNREADABLE"],
    [{ markPrice: null }, "MARK_PRICE_UNAVAILABLE"],
    [{ persistenceHealthy: false }, "PERSISTENCE_UNHEALTHY"]
  ];
  for (const [override, code] of cases) {
    const result = compareRecoveryState(healthyInput(override));
    assert.equal(result.outcome, "ERROR", code);
    assert.ok(result.errorCodes.includes(code), JSON.stringify(result.errorCodes));
  }
});

test("7: a comparison that throws reports a specific code, not a generic error", () => {
  const exploding = { exportState: () => { throw new Error("ledger read failed"); }, snapshot: () => { throw new Error("unused"); } };
  const result = compareRecoveryState(healthyInput({ broker: exploding }));
  assert.equal(result.outcome, "ERROR");
  assert.ok(result.errorCodes.includes("COMPARISON_THREW"), JSON.stringify(result.errorCodes));
  assert.equal(result.evidence.some((item) => item.includes("ledger read failed")), false);
});

test("7b: main.ts registers all four recovery handlers", () => {
  for (const channel of ["recovery:status", "recovery:reconcile", "recovery:owner-review", "recovery:complete"]) {
    assert.ok(recoveryIpcSource.includes(`ipcMain.handle("${channel}"`), `${channel} handler must be registered`);
  }
});

test("8: owner approval is refused before the comparison MATCHES", () => {
  const mismatched = compareRecoveryState(healthyInput({ killSwitchActive: true }));
  const result = approveRecoveryReview({ comparison: mismatched, explicitOwnerAction: true, reviewedAt: CHECKED_AT });
  assert.equal(result.approved, false);
  assert.equal(result.approval, null);
  assert.equal(result.refusal, "RECONCILIATION_NOT_MATCHED");

  const errored = compareRecoveryState(healthyInput({ broker: null }));
  assert.equal(approveRecoveryReview({ comparison: errored, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).refusal, "RECONCILIATION_NOT_MATCHED");
});

test("8b: approval is refused without an explicit owner action", () => {
  const matched = compareRecoveryState(healthyInput());
  const result = approveRecoveryReview({ comparison: matched, explicitOwnerAction: false, reviewedAt: CHECKED_AT });
  assert.equal(result.approved, false);
  assert.equal(result.refusal, "OWNER_ACTION_NOT_EXPLICIT");
});

test("9: an explicit owner click on a MATCHED comparison creates an approval", () => {
  const matched = compareRecoveryState(healthyInput());
  const result = approveRecoveryReview({ comparison: matched, explicitOwnerAction: true, reviewedAt: CHECKED_AT + 1_000 });
  assert.equal(result.approved, true);
  assert.equal(result.approval.reviewer, "local-owner");
  assert.equal(result.approval.decision, "APPROVED");
  assert.equal(result.approval.recoveryRecordId, "snapshot-1");
  assert.equal(result.approval.reconciliationFingerprint, matched.fingerprint);
  assert.equal(result.approval.reviewedAt, CHECKED_AT + 1_000);
});

test("10: a changed fingerprint invalidates an existing approval", () => {
  const state = new RecoveryReviewState();
  const first = compareRecoveryState(healthyInput());
  state.recordComparison(first);
  state.recordApproval(approveRecoveryReview({ comparison: first, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval);
  assert.equal(state.status().ownerApproved, true);

  const second = compareRecoveryState(healthyInput({ killSwitchActive: true }));
  assert.notEqual(second.fingerprint, first.fingerprint);
  state.recordComparison(second);

  assert.equal(state.status().ownerApproved, false, "an approval must not survive the state it approved");
  assert.equal(state.status().approvalAllowed, false);
  assert.equal(state.status().gate, "BLOCKED");
});

test("10b: completion refuses a stale approval even when both are supplied together", () => {
  const first = compareRecoveryState(healthyInput());
  const approval = approveRecoveryReview({ comparison: first, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval;
  const later = compareRecoveryState(healthyInput({ checkedAt: CHECKED_AT + 60_000, markerlessEvidence: ["/scratch/open"] }));
  const result = completeRecovery({ comparison: later, approval, completedAt: CHECKED_AT + 61_000 });
  assert.equal(result.gate, "BLOCKED");
  assert.ok(["RECONCILIATION_NOT_MATCHED", "APPROVAL_FINGERPRINT_STALE"].includes(result.refusal), result.refusal);
  assert.equal(result.auditEvent.kind, "RECOVERY_COMPLETION_REFUSED");
});

test("10c: an approval for a different recovery record cannot complete this one", () => {
  const mine = compareRecoveryState(healthyInput());
  const other = compareRecoveryState(healthyInput({ recoveryRecordId: "snapshot-2" }));
  const otherApproval = approveRecoveryReview({ comparison: other, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval;
  const result = completeRecovery({ comparison: mine, approval: otherApproval, completedAt: CHECKED_AT });
  assert.equal(result.gate, "BLOCKED");
  assert.equal(result.refusal, "APPROVAL_RECORD_MISMATCH");
});

test("11: MATCHED plus a matching approval clears the recovery gate", () => {
  const matched = compareRecoveryState(healthyInput());
  const approval = approveRecoveryReview({ comparison: matched, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval;
  const result = completeRecovery({ comparison: matched, approval, completedAt: CHECKED_AT + 2_000 });
  assert.equal(result.gate, "CLEAR");
  assert.equal(result.refusal, null);
  assert.deepEqual([...result.clearedReasonCodes], ["RECONCILIATION_REQUIRED"]);
  assert.equal(result.auditEvent.kind, "RECOVERY_COMPLETED");
  assert.equal(result.auditEvent.reviewer, "local-owner");
  assert.equal(result.auditEvent.reconciliationFingerprint, matched.fingerprint);
});

test("11b: completion is refused with no approval at all", () => {
  const matched = compareRecoveryState(healthyInput());
  const result = completeRecovery({ comparison: matched, approval: null, completedAt: CHECKED_AT });
  assert.equal(result.gate, "BLOCKED");
  assert.equal(result.refusal, "OWNER_APPROVAL_MISSING");
});

test("12: a completed recovery record is marked COMPLETED, never deleted", () => {
  const matched = compareRecoveryState(healthyInput());
  const approval = approveRecoveryReview({ comparison: matched, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval;
  const result = completeRecovery({ comparison: matched, approval, completedAt: CHECKED_AT });
  assert.equal(result.recoveryRecordStatus, "COMPLETED");
  assert.equal(result.auditEvent.recoveryRecordId, "snapshot-1");
});

test("13: no code path in this module deletes a record or an evidence archive", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "recovery", "recoveryReconciliation.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["rm(", "rmSync", "unlink", "removeShadowArchive", "DELETE FROM", "truncate"]) {
    assert.equal(code.includes(forbidden), false, `reconciliation must never reference ${forbidden}`);
  }
});

test("14-16: the module starts no Shadow session, calls no private API, and mutates nothing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "recovery", "recoveryReconciliation.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["shadowRuntime", ".start(", "api.upbit.com", "access_key", "secret_key", "node:http", "fetch(", ".buy(", ".sell("]) {
    assert.equal(code.includes(forbidden), false, `reconciliation must never reference ${forbidden}`);
  }
  const brokerCalls = [...code.matchAll(/broker\.(\w+)\(/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(brokerCalls)].sort(), ["exportState", "snapshot"], JSON.stringify(brokerCalls));
});

test("17: the comparison result carries no secret and no absolute path", () => {
  const result = compareRecoveryState(healthyInput({ markerlessEvidence: [`${["", "home", "someone", "shadow-evidence", "open"].join("/")}`] }));
  const rendered = JSON.stringify(result);
  assert.equal(/\/home\/|\/Users\/|[A-Za-z]:\\/.test(rendered), false, "no absolute user path may reach the result");
  assert.equal(/secret|token|api[-_]?key|password/i.test(rendered), false, "no credential-shaped field may reach the result");
});

test("18-19: the renderer stays sandboxed with node integration off", () => {
  const options = mainSource.match(/webPreferences:\s*\{[\s\S]*?\}/);
  assert.ok(options, "webPreferences must be configured");
  assert.match(options[0], /sandbox:\s*true/);
  assert.match(options[0], /contextIsolation:\s*true/);
  assert.equal(/nodeIntegration:\s*true/.test(options[0]), false, "node integration must not be enabled");
});

test("18b: the preload exposes only the four fixed recovery channels", () => {
  const block = preloadSource.match(/const recoveryReview: RecoveryReviewApi = Object\.freeze\(\{[\s\S]*?\}\);/);
  assert.ok(block, "the recovery bridge must be a frozen fixed-channel object");
  const channels = [...block[0].matchAll(/"(recovery:[a-z-]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(channels, ["recovery:complete", "recovery:owner-review", "recovery:reconcile", "recovery:status"]);
  assert.equal(preloadSource.includes("exposeInMainWorld(\"ipcRenderer\""), false);
  assert.equal(/exposeInMainWorld\([^)]*,\s*ipcRenderer\s*\)/.test(preloadSource), false);
  assert.equal(preloadSource.includes("require(\"node:fs\")"), false);
  assert.equal(preloadSource.includes("process.env"), false);
});

test("18c: the owner-review payload accepts only an explicit literal confirmation", () => {
  assert.deepEqual(parseRecoveryOwnerReviewIpc({ confirmed: true }), { confirmed: true });
  for (const bad of [{ confirmed: "true" }, { confirmed: 1 }, { confirmed: {} }, { confirmed: false }, {}, null, [], { confirmed: true, extra: 1 }]) {
    assert.throws(() => parseRecoveryOwnerReviewIpc(bad), JSON.stringify(bad));
  }
  for (const parse of [parseRecoveryStatusIpc, parseRecoveryReconcileIpc, parseRecoveryCompleteIpc]) {
    assert.deepEqual(parse(null), {});
    assert.deepEqual(parse({}), {});
    assert.throws(() => parse({ fingerprint: "x" }));
    assert.throws(() => parse({ reviewer: "local-owner" }));
  }
});

test("20: the reported status matches the underlying comparison at every step", () => {
  const state = new RecoveryReviewState();
  assert.deepEqual(state.status(), {
    reconciliation: "NOT_RUN", mismatchCodes: [], errorCodes: [], fingerprint: null,
    checkedAt: null, recoveryRecordId: null, ownerApproved: false, approvalStale: false,
    gate: "BLOCKED", approvalAllowed: false
  });

  const mismatched = compareRecoveryState(healthyInput({ killSwitchActive: true }));
  state.recordComparison(mismatched);
  assert.equal(state.status().reconciliation, "MISMATCHED");
  assert.equal(state.status().approvalAllowed, false, "the approve button must stay disabled while mismatched");
  assert.equal(state.status().gate, "BLOCKED");

  const matched = compareRecoveryState(healthyInput());
  state.recordComparison(matched);
  assert.equal(state.status().reconciliation, "MATCHED");
  assert.equal(state.status().approvalAllowed, true);
  assert.equal(state.status().ownerApproved, false, "MATCHED alone is not approval");
  assert.equal(state.status().gate, "BLOCKED", "MATCHED alone does not clear the gate");

  state.recordApproval(approveRecoveryReview({ comparison: matched, explicitOwnerAction: true, reviewedAt: CHECKED_AT }).approval);
  assert.equal(state.status().ownerApproved, true);
  assert.equal(state.status().gate, "BLOCKED", "approval alone does not clear the gate either");

  state.markCompleted();
  assert.equal(state.status().gate, "CLEAR");
  assert.equal(state.status().fingerprint, matched.fingerprint);
  assert.equal(state.status().recoveryRecordId, "snapshot-1");
});

test("20b: main.ts derives the comparison from its own state, never from the renderer", () => {
  const builder = mainSource.match(/function buildRecoveryComparison\(\)[\s\S]*?\n\}/);
  assert.ok(builder, "the comparison builder must exist");
  assert.match(builder[0], /function buildRecoveryComparison\(\): /);
  assert.equal(/buildRecoveryComparison\(\s*\w+/.test(mainSource), false, "the builder must take no caller input");

  const approveHandler = recoveryIpcSource.match(/ipcMain\.handle\("recovery:owner-review"[\s\S]*?\n\s*\}\);/);
  assert.ok(approveHandler, "the owner-review handler must exist");
  assert.match(approveHandler[0], /recoveryReview\.latestComparison\(\)/);
  assert.match(approveHandler[0], /has not been run/);
  assert.match(approveHandler[0], /explicitOwnerAction: true/);
});

// Historical admin renderer remains regression-tested below, but the canonical consumer
// renderer must never surface recovery owner authority controls.
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "renderer", "renderer.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "renderer", "index.html"), "utf8");

test("UI: canonical consumer renderer exposes no recovery owner authority controls", () => {
  assert.doesNotMatch(indexHtml, /id="recovery-review"/);
  assert.doesNotMatch(indexHtml, /id="approve-recovery-review"/);
  assert.doesNotMatch(indexHtml, /id="complete-recovery"/);
  assert.doesNotMatch(indexHtml, /recovery:owner-review|recovery:complete/);
});

test("UI: the historical approve control is gated on the main process's own verdict", () => {
  const render = rendererSource.match(/function renderRecoveryReview\(status\)[\s\S]*?\n\}/);
  assert.ok(render, "renderRecoveryReview must exist");
  assert.match(render[0], /approve\.disabled = !status\.approvalAllowed/);
  assert.equal((render[0].match(/approve\.disabled\s*=/g) ?? []).length, 1);
  assert.equal((render[0].match(/complete\.disabled\s*=/g) ?? []).length, 1);
  assert.match(render[0], /complete\.disabled = !\(status\.ownerApproved && status\.reconciliation === "MATCHED"\)/);
});

test("UI: a finished historical request restores controls from status, never blanket-enables them", () => {
  const wire = rendererSource.match(/const wireRecoveryButton = [\s\S]*?\n\};/);
  assert.ok(wire, "wireRecoveryButton must exist");
  assert.match(wire[0], /finally \{\s*restoreRecoveryControls\(\);\s*\}/);
  assert.equal(/finally \{[\s\S]*?button\.disabled = false/.test(wire[0]), false, "controls must not be blanket re-enabled");

  const restore = rendererSource.match(/const restoreRecoveryControls = \(\) => \{[\s\S]*?\n\};/);
  assert.ok(restore, "restoreRecoveryControls must exist");
  assert.match(restore[0], /renderRecoveryReview\(lastRecoveryStatus\)/);
});

test("UI: historical recovery rendering uses no HTML string or inline style", () => {
  const panelCode = rendererSource.match(/function renderRecoveryReview[\s\S]*?wireRecoveryButton\("complete-recovery"[^\n]*\n/);
  assert.ok(panelCode, "the recovery panel block must exist");
  assert.equal(/\.innerHTML\s*=/.test(panelCode[0]), false, "strict CSP forbids innerHTML");
  assert.equal(/\.style\./.test(panelCode[0]), false, "strict CSP forbids inline style writes");
  assert.match(panelCode[0], /fingerprint\.slice\(0, 12\)/);
});
