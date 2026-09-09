"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FRESHNESS_WINDOW_MS, describeRefusal, knownRefusalCodes, freshnessStage,
  freshnessProgress, describeAge, inheritedStage, lampLevels
} = require("../dist/apps/mobile/src/instrumentState.js");

/**
 * The screen this module replaces showed "mobile session request rejected (403)." for three
 * different account states, and the operator spent days suspecting a token that had in fact
 * authenticated. Every assertion below is about that never being possible again.
 */

test("every refusal resolves to a gate, a sentence and a next action", () => {
  for (const code of knownRefusalCodes()) {
    const refusal = describeRefusal(code);
    assert.equal(refusal.code, code);
    assert.ok(["DATA", "LINK", "GATE"].includes(refusal.gate), code);
    assert.ok(refusal.title.length > 0, code);
    assert.ok(refusal.detail.length > 0, code);
    assert.ok(refusal.action.length > 0, `${code} must say what happens next`);
  }
});

test("the taxonomy covers the server's whole refusal set", () => {
  assert.deepEqual(knownRefusalCodes(), [
    "CREDENTIAL_REJECTED", "DAILY_LOSS_LIMIT", "KILL_SWITCH_ACTIVE", "MARKET_DATA_STALE",
    "MAX_ORDER_NOTIONAL", "NO_CREDENTIAL", "PRICE_DEVIATION_LIMIT", "SESSION_DRAWDOWN_LIMIT",
    "USER_IDENTITY_MISMATCH", "USER_NOT_ACTIVE", "USER_NOT_REGISTERED"
  ]);
});

test("every session-gate state stays distinguishable from the others", () => {
  const session = ["NO_CREDENTIAL", "CREDENTIAL_REJECTED", "USER_NOT_REGISTERED", "USER_NOT_ACTIVE", "USER_IDENTITY_MISMATCH"];
  assert.equal(new Set(session.map((code) => describeRefusal(code).title)).size, session.length);
  for (const code of session) assert.equal(describeRefusal(code).gate, "LINK");
});

test("a bare 401 blames the credential and a bare 403 clears it", () => {
  // The two used to share one "token expired" sentence. That is right for 401 and wrong for
  // 403, and the wrong half is what sent the operator back to a token that had authenticated.
  assert.match(describeRefusal(undefined, 401).title, /만료되었거나 이미 사용/);
  assert.match(describeRefusal(undefined, 403).detail, /토큰 문제는 아닙니다/);
  assert.notEqual(describeRefusal(undefined, 401).title, describeRefusal(undefined, 403).title);
});

test("an unknown code still yields an actionable record, never a bare status", () => {
  const unknown = describeRefusal(undefined, 403);
  assert.ok(unknown.title.length > 0);
  assert.ok(unknown.action.length > 0);
  assert.doesNotMatch(unknown.title, /^\(?\d{3}\)?$/);
  // A 403 means the credential authenticated, so the record must not send the operator back to the token.
  assert.match(unknown.detail, /토큰 문제는 아닙니다/);
  assert.equal(describeRefusal(undefined, 500).code, "HTTP_500");
  assert.equal(describeRefusal("lower_case").code, "UNKNOWN");
  assert.equal(describeRefusal({ evil: true }).code, "UNKNOWN");
});

test("only KILL_SWITCH_ACTIVE halts; the rest reject", () => {
  const halting = knownRefusalCodes().filter((code) => describeRefusal(code).severity === "HALT");
  assert.deepEqual(halting, ["KILL_SWITCH_ACTIVE"]);
});

test("freshness stages are fractions of the window, so a narrower window narrows them all", () => {
  const at = (age, windowMs) => freshnessStage(1_000_000, 1_000_000 + age, windowMs);
  assert.equal(at(0, FRESHNESS_WINDOW_MS), "FRESH");
  assert.equal(at(4_000, FRESHNESS_WINDOW_MS), "FRESH");
  assert.equal(at(6_000, FRESHNESS_WINDOW_MS), "AGING");
  assert.equal(at(13_000, FRESHNESS_WINDOW_MS), "EXPIRING");
  assert.equal(at(15_000, FRESHNESS_WINDOW_MS), "STALE");
  // Same ratios against a 3s window.
  assert.equal(at(800, 3_000), "FRESH");
  assert.equal(at(1_500, 3_000), "AGING");
  assert.equal(at(2_900, 3_000), "EXPIRING");
});

test("a value from the future is stale, not fresh", () => {
  assert.equal(freshnessStage(1_000_000, 999_000), "STALE");
  assert.equal(freshnessProgress(1_000_000, 999_000), 1);
  assert.match(describeAge(1_000_000, 999_000), /앞섭니다/);
});

test("non-finite input fails closed rather than reading as fresh", () => {
  assert.equal(freshnessStage(Number.NaN, 1_000), "STALE");
  assert.equal(freshnessStage(1_000, Number.NaN), "STALE");
  assert.equal(freshnessStage(1_000, 1_000, 0), "STALE");
  assert.equal(describeAge(Number.NaN, 1_000), "시각 불명");
});

test("a derived value inherits the age of its oldest input", () => {
  assert.equal(inheritedStage(["FRESH", "STALE"]), "STALE");
  assert.equal(inheritedStage(["FRESH", "AGING"]), "AGING");
  assert.equal(inheritedStage(["FRESH", "FRESH"]), "FRESH");
  assert.equal(inheritedStage([]), "FRESH");
});

test("no refusals leaves every lamp dark, and a halt outranks a reject on the same gate", () => {
  assert.deepEqual({ ...lampLevels([]) }, { DATA: "OFF", LINK: "OFF", GATE: "OFF" });
  assert.equal(lampLevels([describeRefusal("MARKET_DATA_STALE")]).DATA, "WARNING");
  assert.equal(lampLevels([describeRefusal("USER_NOT_ACTIVE")]).LINK, "WARNING");
  const both = lampLevels([describeRefusal("MAX_ORDER_NOTIONAL"), describeRefusal("KILL_SWITCH_ACTIVE")]);
  assert.equal(both.GATE, "DANGER");
  assert.equal(both.DATA, "OFF");
});

test("an observed runtime state is reported without inventing a cause", () => {
  const { runtimeDegradedRefusal } = require("../dist/apps/mobile/src/instrumentState.js");
  const degraded = runtimeDegradedRefusal(false);
  const halted = runtimeDegradedRefusal(true);
  assert.equal(degraded.severity, "REJECT");
  assert.equal(halted.severity, "HALT");
  assert.equal(degraded.gate, "GATE");
  // It must not claim a specific fault, because `health` does not carry one.
  for (const record of [degraded, halted]) {
    assert.doesNotMatch(record.title, /시세|토큰|네트워크/);
    assert.ok(record.action.length > 0);
  }
  // Neither observed-state helper may leak into the server's own vocabulary table.
  assert.equal(knownRefusalCodes().includes("RUNTIME_DEGRADED"), false);
  assert.equal(knownRefusalCodes().includes("SESSION_NOT_LINKED"), false);
});

test("age reads in the operator's units", () => {
  const base = 1_000_000;
  assert.equal(describeAge(base, base + 500), "방금");
  assert.equal(describeAge(base, base + 2_000), "2초 전");
  assert.equal(describeAge(base, base + 120_000), "2분 전");
  assert.equal(describeAge(base, base + 7_200_000), "2시간 전");
});
