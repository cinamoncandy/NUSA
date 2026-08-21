"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR,
  runExternalReadOnlyEnvironmentPreflight,
} = require("../dist/apps/desktop/src/exchange/externalReadOnlyEnvironmentPreflight.js");
const { validateExternalReadOnlyEnvironmentPreflight } = require("../scripts/validate-external-readonly-environment-preflight.js");

const REV = "1".repeat(40);
const HASH = (char) => char.repeat(64);

function request(overrides = {}) {
  return {
    operatorAuthorizedExternalProbe: true,
    operatorRequestId: "operator-request-1",
    codeRevision: REV,
    configurationHash: HASH("2"),
    releaseSealFingerprint: HASH("3"),
    boundedEnvelopeFingerprint: HASH("4"),
    timeoutMs: 5000,
    ...overrides,
  };
}

const snapshot = Object.freeze({
  observedAt: "2026-08-08T02:00:00.000Z",
  accounts: Object.freeze([
    Object.freeze({ currency: "KRW", balance: "123456", locked: "0", avg_buy_price: "0", avg_buy_price_modified: false, unit_currency: "KRW" }),
  ]),
  openOrders: Object.freeze([]),
});

function port(overrides = {}) {
  return {
    status: async () => ({ configured: true, accessKeyHint: "ABCD…WXYZ", provider: "electron-safe-storage" }),
    captureSnapshot: async () => ({ ok: true, code: "CONNECTED", message: "ok", observedAt: snapshot.observedAt, data: snapshot }),
    ...overrides,
  };
}

test("operator authorization false performs no port calls and returns NOT_RUN", async () => {
  let calls = 0;
  const result = await runExternalReadOnlyEnvironmentPreflight(
    request({ operatorAuthorizedExternalProbe: false }),
    {
      status: async () => { calls += 1; throw new Error("must not run"); },
      captureSnapshot: async () => { calls += 1; throw new Error("must not run"); },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.verdict, "NOT_RUN");
  assert.equal(result.probePerformed, false);
  assert.equal(result.authorizesLive, false);
});

test("synthetic authenticated observation is ready for human review only", async () => {
  const result = await runExternalReadOnlyEnvironmentPreflight(request(), port());
  assert.equal(result.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.equal(result.probePerformed, true);
  assert.equal(result.credentialConfigured, true);
  assert.equal(result.resultCode, "CONNECTED");
  assert.equal(result.accountCount, 1);
  assert.equal(result.openOrderCount, 0);
  assert.match(result.snapshotDigest, /^[0-9a-f]{64}$/);
  assert.match(result.receiptFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.orderAuthorization, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.credentialExecutionUse, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /123456|ABCD…WXYZ/);
});

test("missing or rejected read-only credential state blocks safely", async () => {
  const missing = await runExternalReadOnlyEnvironmentPreflight(request(), port({
    status: async () => ({ configured: false, accessKeyHint: null, provider: "electron-safe-storage" }),
    captureSnapshot: async () => { throw new Error("must not run"); },
  }));
  assert.equal(missing.verdict, "SAFE_BLOCK");
  assert.equal(missing.probePerformed, false);

  for (const code of ["INVALID_CREDENTIALS", "IP_NOT_ALLOWED"]) {
    const result = await runExternalReadOnlyEnvironmentPreflight(request(), port({
      captureSnapshot: async () => ({ ok: false, code, message: "rejected", observedAt: snapshot.observedAt }),
    }));
    assert.equal(result.verdict, "SAFE_BLOCK");
    assert.equal(result.authorizesLive, false);
  }
});

test("network timeout and provider ambiguity remain UNKNOWN", async () => {
  for (const code of ["NETWORK_ERROR", "TIMEOUT", "PROVIDER_ERROR"]) {
    const result = await runExternalReadOnlyEnvironmentPreflight(request(), port({
      captureSnapshot: async () => ({ ok: false, code, message: "ambiguous", observedAt: snapshot.observedAt }),
    }));
    assert.equal(result.verdict, "UNKNOWN");
    assert.equal(result.executionAuthority, false);
  }

  const statusFailure = await runExternalReadOnlyEnvironmentPreflight(request(), port({ status: async () => { throw new Error("status unavailable"); } }));
  assert.equal(statusFailure.verdict, "UNKNOWN");
  assert.equal(statusFailure.probePerformed, false);
});

test("identical normalized observations produce identical receipt fingerprints", async () => {
  const first = await runExternalReadOnlyEnvironmentPreflight(request(), port());
  const second = await runExternalReadOnlyEnvironmentPreflight(request(), port());
  assert.equal(first.receiptFingerprint, second.receiptFingerprint);
  const changed = await runExternalReadOnlyEnvironmentPreflight(request({ operatorRequestId: "operator-request-2" }), port());
  assert.notEqual(first.receiptFingerprint, changed.receiptFingerprint);
});

test("source guard proves preflight has no mutation or credential execution authority", () => {
  const result = validateExternalReadOnlyEnvironmentPreflight();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.actualExternalProbeInCi, false);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.explicitOperatorAuthorizationRequired, true);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.activationAuthority, false);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.orderAuthorization, false);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.executionAuthority, false);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.authorizesLive, false);
  assert.equal(EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
