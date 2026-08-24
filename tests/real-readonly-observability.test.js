const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateRealReadOnlyObservabilitySnapshot
} = require("../dist/packages/contracts/src/realReadOnlyObservability.js");
const { handleRealReadOnlyOperationsHttp } = require("../dist/apps/cloud/src/realReadOnlyOperationsHttp.js");
const { loadRealReadOnlyOperations } = require("../dist/apps/mobile/src/realReadOnlyOperationsClient.js");
const { setConfiguredPaperEndpoint, markPaperConnectionVerified } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "REAL_READ_ONLY",
    readOnly: true,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
    runtimeStatus: "HEALTHY",
    generatedAt: 1_700_000_000_000,
    connection: { code: "CONNECTED", connected: true, lastSuccessfulRefreshAt: 1_700_000_000_000, lastErrorAt: null, lastErrorReason: null },
    freshness: "FRESH",
    account: {
      maskedAccountReference: "abcd****wxyz",
      observedAt: 1_700_000_000_000,
      observedCashKrw: 1_500_000,
      observedLockedKrw: 0,
      observedAssets: [{ currency: "BTC", available: 0.25, locked: 0, avgBuyPrice: 90_000_000, unitCurrency: "KRW" }],
      openOrderCount: 2
    },
    reconciliation: { status: "MATCH", observedAt: 1_700_000_000_000, reason: "Consecutive read-only broker snapshots match", changedCurrencies: [], openOrderDifferenceCount: 0 },
    credentialReadiness: { configured: true, provider: "electron-safe-storage", maskedCredentialHint: "ab****yz" },
    blockers: [],
    alerts: [],
    events: [{ id: "real-1", sequence: 1, mode: "REAL_READ_ONLY", eventType: "ACCOUNT_REFRESH", occurredAt: 1_700_000_000_000, reason: "Read-only account snapshot refreshed", reasonCodes: ["REFRESH_OK"] }],
    counters: { refreshCount: 1, errorCount: 0, reconciliationCount: 1, orderMutationCount: 0, withdrawalCount: 0, transferCount: 0, cashMutationCount: 0, positionMutationCount: 0 },
    ...overrides
  };
}

// ---------------------------------------------------------------- contract

test("#661: a canonical REAL_READ_ONLY snapshot validates and is returned frozen", () => {
  const validated = validateRealReadOnlyObservabilitySnapshot(snapshot());
  assert.equal(validated.mode, "REAL_READ_ONLY");
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(validated.account.observedCashKrw, 1_500_000);
  assert.equal(validated.reconciliation.status, "MATCH");
});

test("#661: authority invariants cannot be weakened by the payload", () => {
  for (const override of [
    { mode: "PAPER" }, { readOnly: false }, { liveAuthority: "FULL" },
    { productionMutationAllowed: true }, { aiAuthority: "FULL" }, { schemaVersion: 2 }
  ]) {
    assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot(override)), /authority invariant violated|schemaVersion/i, JSON.stringify(override));
  }
});

test("#661: any non-zero mutation counter is rejected outright", () => {
  for (const name of ["orderMutationCount", "withdrawalCount", "transferCount", "cashMutationCount", "positionMutationCount"]) {
    const counters = { ...snapshot().counters, [name]: 1 };
    assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ counters })), /mutation invariant violated/, name);
  }
});

test("#661: credential-shaped keys and values are rejected recursively, at any depth", () => {
  for (const account of [
    { ...snapshot().account, accountId: "raw-account-id" },
    { ...snapshot().account, accessKey: "AKIA-raw" },
    { ...snapshot().account, nested: { deeper: { authorization: "Bearer x" } } },
    { ...snapshot().account, observedAssets: [{ currency: "BTC", available: 1, locked: 0, avgBuyPrice: 1, unitCurrency: "KRW", uuid: "abc" }] }
  ]) {
    assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ account })), /prohibited/i);
  }
  // A credential can also hide under an innocent key name, so values are swept too.
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({
    connection: { code: "ERROR_UNUSED", connected: false, lastSuccessfulRefreshAt: null, lastErrorAt: 1, lastErrorReason: "Bearer eyJhbGciOiJIUzUxMiJ9.leak" }
  })), /invalid REAL_READ_ONLY connection code|prohibited/i);
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({
    connection: { code: "PROVIDER_ERROR", connected: false, lastSuccessfulRefreshAt: null, lastErrorAt: 1, lastErrorReason: "Bearer eyJhbGciOiJIUzUxMiJ9.leak" }
  })), /prohibited credential material/i);
});

test("#661: account identity must be masked, never raw", () => {
  for (const reference of ["raw-account-uuid-1234", "AKIAIOSFODNN7EXAMPLE", "abcdefghijklmnop"]) {
    assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ account: { ...snapshot().account, maskedAccountReference: reference } })), /must be masked/);
  }
  assert.doesNotThrow(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ account: { ...snapshot().account, maskedAccountReference: null } })));
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ credentialReadiness: { configured: true, provider: "p", maskedCredentialHint: "fullkeyvalue123456" } })), /must be masked/);
});

test("#661: unobserved values stay null and are never coerced to a fake zero", () => {
  const unknown = validateRealReadOnlyObservabilitySnapshot(snapshot({
    runtimeStatus: "OFFLINE",
    connection: { code: "NOT_CONFIGURED", connected: false, lastSuccessfulRefreshAt: null, lastErrorAt: null, lastErrorReason: null },
    freshness: "UNKNOWN",
    account: { maskedAccountReference: null, observedAt: null, observedCashKrw: null, observedLockedKrw: null, observedAssets: [], openOrderCount: null },
    reconciliation: { status: "UNKNOWN", observedAt: null, reason: "No prior read-only broker baseline is available", changedCurrencies: [], openOrderDifferenceCount: null }
  }));
  assert.equal(unknown.account.observedCashKrw, null);
  assert.notEqual(unknown.account.observedCashKrw, 0);
  assert.equal(unknown.account.openOrderCount, null);
  assert.equal(unknown.reconciliation.openOrderDifferenceCount, null);
});

test("#661: connected flag cannot contradict its connection code", () => {
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({
    connection: { code: "NETWORK_ERROR", connected: true, lastSuccessfulRefreshAt: null, lastErrorAt: 1, lastErrorReason: "network" }
  })), /contradicts its connection code/);
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({
    connection: { code: "CONNECTED", connected: false, lastSuccessfulRefreshAt: 1, lastErrorAt: null, lastErrorReason: null }
  })), /contradicts its connection code/);
});

test("#661: the contract expresses exactly the canonical read-only service result codes", () => {
  // A code the service can emit but the contract cannot express would silently degrade into
  // something vaguer before it ever reaches the operator.
  const service = read("apps/desktop/src/exchange/upbitReadOnlyService.ts");
  const serviceCodes = service.slice(service.indexOf("export type UpbitReadOnlyResultCode"), service.indexOf(";", service.indexOf("export type UpbitReadOnlyResultCode")))
    .match(/"([A-Z_]+)"/g).map((value) => value.replace(/"/g, "")).sort();
  const contract = read("packages/contracts/src/realReadOnlyObservability.ts");
  const contractCodes = contract.slice(contract.indexOf("export type RealReadOnlyConnectionCode"), contract.indexOf(";", contract.indexOf("export type RealReadOnlyConnectionCode")))
    .match(/"([A-Z_]+)"/g).map((value) => value.replace(/"/g, "")).sort();
  assert.deepEqual(contractCodes, serviceCodes);
});

test("#661: reconciliation statuses mirror the canonical reconciliation module", () => {
  const canonical = read("apps/desktop/src/exchange/upbitReadOnlyReconciliation.ts");
  assert.match(canonical, /"MATCH" \| "DIFF" \| "UNKNOWN"/);
  for (const status of ["MATCH", "DIFF", "UNKNOWN"]) {
    assert.doesNotThrow(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ reconciliation: { ...snapshot().reconciliation, status } })), status);
  }
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ reconciliation: { ...snapshot().reconciliation, status: "REPAIRED" } })), /invalid REAL_READ_ONLY reconciliation status/);
});

test("#661: events and alerts are bounded, deduplicated and deterministically ordered", () => {
  const base = snapshot();
  const duplicate = [base.events[0], { ...base.events[0], sequence: 2 }];
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ events: duplicate })), /duplicate REAL_READ_ONLY event id/);
  const outOfOrder = [{ ...base.events[0], id: "a", sequence: 2 }, { ...base.events[0], id: "b", sequence: 1 }];
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ events: outOfOrder })), /sequence is not deterministic/);
  const tooMany = Array.from({ length: 501 }, (_, index) => ({ ...base.events[0], id: `e${index}`, sequence: index + 1 }));
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ events: tooMany })), /event bound exceeded/);
  const alerts = Array.from({ length: 65 }, () => ({ code: "ACCOUNT_DATA_STALE", severity: "WARNING", raisedAt: 1, reason: "stale" }));
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ alerts })), /alert bound exceeded/);
});

test("#661: alert codes cover every canonical REAL_READ_ONLY alert condition", () => {
  for (const code of ["ACCOUNT_DATA_STALE", "BROKER_DISCONNECTED", "AUTH_FAILURE", "RECONCILIATION_MISMATCH", "BALANCE_DRIFT", "RELAY_FAILURE", "CREDENTIAL_READINESS_REGRESSION"]) {
    const validated = validateRealReadOnlyObservabilitySnapshot(snapshot({ alerts: [{ code, severity: "WARNING", raisedAt: 1, reason: "observed" }] }));
    assert.equal(validated.alerts[0].code, code);
  }
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ alerts: [{ code: "PLACE_ORDER", severity: "WARNING", raisedAt: 1, reason: "x" }] })), /invalid REAL_READ_ONLY alert/);
});

test("#661: duplicate asset currencies are rejected so a balance cannot be double-counted", () => {
  const observedAssets = [
    { currency: "BTC", available: 1, locked: 0, avgBuyPrice: 1, unitCurrency: "KRW" },
    { currency: "BTC", available: 2, locked: 0, avgBuyPrice: 1, unitCurrency: "KRW" }
  ];
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ account: { ...snapshot().account, observedAssets } })), /duplicate REAL_READ_ONLY asset currency/);
});

// ---------------------------------------------------------------- transport

const verifier = { verify: (token) => token === "good-token" ? { userId: "operator", scopes: ["dashboard:read"] } : undefined };
const request = (overrides = {}) => ({ method: "GET", headers: { authorization: "Bearer good-token" }, ...overrides });
const parsed = (response) => JSON.parse(response.body);

test("#661: the transport is GET-only and authenticated", () => {
  const ok = handleRealReadOnlyOperationsHttp(request(), { tokenVerifier: verifier, loadSnapshot: () => snapshot() });
  assert.equal(ok.status, 200);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const rejected = handleRealReadOnlyOperationsHttp(request({ method }), { tokenVerifier: verifier, loadSnapshot: () => snapshot() });
    assert.notEqual(rejected.status, 200, `${method} must not reach the snapshot`);
  }
  const unauthenticated = handleRealReadOnlyOperationsHttp(request({ headers: {} }), { tokenVerifier: verifier, loadSnapshot: () => snapshot() });
  assert.notEqual(unauthenticated.status, 200);
  const wrongToken = handleRealReadOnlyOperationsHttp(request({ headers: { authorization: "Bearer nope" } }), { tokenVerifier: verifier, loadSnapshot: () => snapshot() });
  assert.notEqual(wrongToken.status, 200);
});

test("#661: repeated GET is idempotent and never mutates loader state", () => {
  let calls = 0;
  const dependencies = { tokenVerifier: verifier, loadSnapshot: () => { calls += 1; return snapshot(); } };
  const first = handleRealReadOnlyOperationsHttp(request(), dependencies);
  const second = handleRealReadOnlyOperationsHttp(request(), dependencies);
  const third = handleRealReadOnlyOperationsHttp(request(), dependencies);
  assert.equal(calls, 3);
  assert.deepEqual(parsed(first), parsed(second));
  assert.deepEqual(parsed(second), parsed(third));
});

test("#661: the transport fails closed without echoing the failure reason", () => {
  const thrown = handleRealReadOnlyOperationsHttp(request(), { tokenVerifier: verifier, loadSnapshot: () => { throw new Error("secret=abc123 leaked detail"); } });
  assert.equal(thrown.status, 503);
  assert.deepEqual(parsed(thrown), { error: "REAL_READONLY_OPERATIONS_UNAVAILABLE" });
  assert.equal(thrown.body.includes("abc123"), false);

  // A loader that returns an unredacted snapshot must not be forwarded either: the boundary
  // that actually leaves the process re-validates rather than trusting its caller.
  const leaky = handleRealReadOnlyOperationsHttp(request(), { tokenVerifier: verifier, loadSnapshot: () => snapshot({ account: { ...snapshot().account, accessKey: "AKIA-raw" } }) });
  assert.equal(leaky.status, 503);
});

test("#661: the transport module exposes no mutation handler at all", () => {
  const source = read("apps/cloud/src/realReadOnlyOperationsHttp.ts");
  assert.match(source, /authorizeDashboardReadRequest/);
  for (const forbidden of ["authorizePaperTradeRequest", "submitOrder", "placeOrder", "withdraw", "transfer", "cancelOrder"]) {
    assert.equal(source.includes(forbidden), false, `transport must not reference ${forbidden}`);
  }
  const server = read("apps/cloud/src/server.ts");
  assert.match(server, /"\/api\/real-readonly-operations"/);
});

// ---------------------------------------------------------------- mobile client

test("#661: the mobile client refuses unverified endpoints and carries no broker credential", async () => {
  setConfiguredPaperEndpoint("");
  const unconfigured = await loadRealReadOnlyOperations({ baseUrl: "https://cloud.example", credentialProvider: async () => "t" });
  assert.equal(unconfigured.status, "NOT_CONFIGURED");

  const source = read("apps/mobile/src/realReadOnlyOperationsClient.ts");
  for (const forbidden of ["accessKey", "secretKey", "UPBIT_ACCESS_KEY", "UPBIT_SECRET_KEY", "createUpbitJwt", "signature"]) {
    assert.equal(source.includes(forbidden), false, `mobile client must not reference ${forbidden}`);
  }
  assert.match(source, /method: "GET"/);
  assert.equal(/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(source), false);
});

test("#661: the mobile client parses a real snapshot and surfaces network failure safely", async () => {
  setConfiguredPaperEndpoint("https://cloud.example");
  markPaperConnectionVerified("https://cloud.example");
  const ok = await loadRealReadOnlyOperations({
    baseUrl: "https://cloud.example",
    credentialProvider: async () => "token",
    request: async () => new Response(JSON.stringify(snapshot()), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(ok.status, "READY");
  assert.equal(ok.snapshot.mode, "REAL_READ_ONLY");
  assert.equal(ok.snapshot.account.observedCashKrw, 1_500_000);

  const failed = await loadRealReadOnlyOperations({
    baseUrl: "https://cloud.example",
    credentialProvider: async () => "token",
    request: async () => { throw new Error("network down"); }
  });
  assert.equal(failed.status, "UNAVAILABLE");
  assert.equal(typeof failed.reason, "string");

  const rejected = await loadRealReadOnlyOperations({
    baseUrl: "https://cloud.example",
    credentialProvider: async () => "token",
    request: async () => new Response("{}", { status: 503 })
  });
  assert.equal(rejected.status, "UNAVAILABLE");
  setConfiguredPaperEndpoint("");
});

// ---------------------------------------------------------------- cockpit + isolation

test("#661: the unified cockpit renders three separate modes without collapsing them", () => {
  const cockpit = read("apps/mobile/src/paperShadowMonitorView.tsx");
  assert.match(cockpit, /\["PAPER", "SHADOW", "REAL"\]/);
  assert.match(cockpit, /testID=\{`monitor-mode-\$\{item\.toLowerCase\(\)\}`\}/);
  assert.match(cockpit, /READ ONLY/);
  assert.match(cockpit, /PaperLearningMonitorView/);
  assert.match(cockpit, /ShadowObservabilityMonitorView/);
  assert.match(cockpit, /RealReadOnlyMonitorView/);
  // Visibility may be aggregated; accounting may not. No cross-mode arithmetic may appear here.
  assert.equal(/paper[\w.]*\s*\+\s*real|real[\w.]*\s*\+\s*paper/i.test(cockpit), false);
});

test("#661: the REAL view is unmistakably read-only and offers no trade control", () => {
  const view = read("apps/mobile/src/realReadOnlyMonitorView.tsx");
  assert.match(view, /REAL · READ ONLY/);
  assert.match(view, /주문·출금·이체 기능이 없으며 PAPER 잔고와 절대 합산되지 않습니다/);
  assert.match(view, /testID="real-readonly-monitor"/);
  for (const testId of ["real-readonly-connection", "real-readonly-account", "real-readonly-reconciliation", "real-readonly-timeline", "real-readonly-counters"]) {
    assert.ok(view.includes(`testID="${testId}"`), `${testId} card must render`);
  }
  // The disclaimer legitimately names the absent capabilities, so assert on interactive controls
  // rather than raw substrings: what must not exist is a way to act, not a way to say "no acting".
  for (const forbidden of ["onSubmit", "placeOrder", "onOrder", "submitOrder", "onWithdraw", "onTransfer", "onEnableLive"]) {
    assert.equal(view.includes(forbidden), false, `REAL view must not wire ${forbidden}`);
  }
  // The only actionable control in the whole view is the optional close button.
  const buttons = view.match(/<NusaButton[^>]*>/g) ?? [];
  assert.equal(buttons.length, 1, "REAL view must expose exactly one control");
  assert.match(buttons[0], /label="닫기"/);
  assert.equal(/<Pressable/.test(view), false, "REAL view must not add bespoke pressable controls");
  // Unobserved values render as UNKNOWN, never as a fabricated zero.
  assert.match(view, /value == null \? "UNKNOWN"/);
});

test("#661: REAL and PAPER accounting cannot be conflated by field name or by value", () => {
  const contract = read("packages/contracts/src/realReadOnlyObservability.ts");
  // The REAL contract deliberately owns no PAPER accounting vocabulary.
  for (const forbidden of ["equity", "realizedPnl", "unrealizedPnl", "paperEquity"]) {
    assert.equal(new RegExp(`readonly\\s+${forbidden}`, "i").test(contract), false, `REAL contract must not declare ${forbidden}`);
  }
  assert.match(contract, /observedCashKrw/);
  assert.match(contract, /observedAssets/);

  // And a REAL snapshot cannot masquerade as a SHADOW or PAPER one.
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({ mode: "SHADOW" })), /authority invariant violated/);
});

test("#661: a REAL snapshot carries no SHADOW decision, permission, risk, order or fill evidence", () => {
  const validated = validateRealReadOnlyObservabilitySnapshot(snapshot());
  const serialized = JSON.stringify(validated).toLowerCase();
  for (const forbidden of ["riskdecision", "hypothetical", "signalid", "commandid", "fill", "permission", "strategyid"]) {
    assert.equal(serialized.includes(forbidden), false, `REAL snapshot must not carry ${forbidden}`);
  }
  // Only canonical REAL lifecycle event types are expressible.
  assert.throws(() => validateRealReadOnlyObservabilitySnapshot(snapshot({
    events: [{ id: "x", sequence: 1, mode: "REAL_READ_ONLY", eventType: "HYPOTHETICAL_FILL", occurredAt: 1, reason: "r", reasonCodes: ["R"] }]
  })), /event type is invalid/);
});
