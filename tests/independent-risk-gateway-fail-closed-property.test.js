"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreTradeRisk, RISK_REASON_ORDER } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { verifyPreTradeRiskDecision } = require("../scripts/lib/paper-risk-gateway-verifier.js");
const { identity, limits, request } = require("./fixtures/risk-gateway-baseline.js");

/**
 * The coverage suite beside this one proves every declared reason code is REACHABLE. That is an
 * existence proof, and it is not the property that matters.
 *
 * `PRICE_DEVIATION_LIMIT` was reachable -- a crafted request tripped it and coverage passed --
 * while the check itself was skippable by nulling the price it compared against. A feed
 * reporting HEALTHY with no price disabled the band entirely, at exactly the moment the
 * reference was unavailable. The independent verifier carried the identical guard, so the two
 * implementations agreed with each other while both failed open. Cross-checking one hand's work
 * against the same hand's second draft is not independence.
 *
 * The property below cannot be satisfied by any implementation that fails open, whoever wrote
 * it: START FROM A REQUEST THAT IS REFUSED, REMOVE OR CORRUPT ONE INPUT, AND THE DECISION MUST
 * NEVER BECOME ALLOW. A check that stops running when its input goes missing turns some refusal
 * into an ALLOW, and this finds it without anyone having predicted which check it would be.
 */

/** Every leaf path in the request, so the property can walk inputs rather than a hand-kept list. */
function leafPaths(value, prefix = []) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.keys(value).flatMap((key) => leafPaths(value[key], [...prefix, key]));
}

function withValueAt(base, path, replacement) {
  const copy = structuredClone(base);
  let cursor = copy;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  const last = path[path.length - 1];
  if (replacement === Symbol.for("delete")) delete cursor[last];
  else cursor[last] = replacement;
  return copy;
}

const CORRUPTIONS = [
  ["null", null],
  ["undefined", undefined],
  ["missing", Symbol.for("delete")],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY]
];

/** Requests that must be refused, one per non-structural reason the fixture can reach. */
const REFUSED = [
  ["price deviation", (r) => { r.marketDataState.price = 5; }],
  ["kill switch", (r) => { r.controlState.killSwitchActive = true; }],
  ["approval missing", (r) => { r.approvalState.approved = false; }],
  ["order notional", (r) => { r.quantity = 10; }],
  ["daily loss", (r) => { r.sessionState.dailyRealizedPnL = -50; }],
  ["session drawdown", (r) => { r.sessionState.sessionEquity = 80; }],
  ["insufficient cash", (r) => { r.accountState.cash = 0; }],
  ["rate limit", (r) => { r.rateState.ordersInLastSecond = 3; }],
  ["deployment integrity", (r) => { r.deploymentState.integrityVerified = false; }],
  ["market data stale", (r) => { r.marketDataState.status = "STALE"; }]
];

test("the baseline is genuinely allowed, or the property below proves nothing", () => {
  assert.equal(evaluatePreTradeRisk(request(), identity, limits).status, "ALLOW");
});

test("no single missing or corrupt input can turn a refusal into an ALLOW", () => {
  const failures = [];
  for (const [label, mutate] of REFUSED) {
    const refused = request();
    mutate(refused);
    assert.notEqual(evaluatePreTradeRisk(refused, identity, limits).status, "ALLOW", `${label} must start refused`);

    for (const path of leafPaths(refused)) {
      for (const [corruption, replacement] of CORRUPTIONS) {
        const damaged = withValueAt(refused, path, replacement);
        const decision = evaluatePreTradeRisk(damaged, identity, limits);
        if (decision.status === "ALLOW") failures.push(`${label}: ${path.join(".")} = ${corruption}`);
      }
    }
  }
  assert.deepEqual(failures, [], `a check stopped running when its input went missing:\n${failures.join("\n")}`);
});

test("the same property holds for the independent verifier, which shares no code", () => {
  // The verifier is a separate re-implementation. Running the property against BOTH is what
  // makes the pair meaningful: agreement alone is satisfied by two identical mistakes.
  const failures = [];
  for (const [label, mutate] of REFUSED) {
    const refused = request();
    mutate(refused);
    for (const path of leafPaths(refused)) {
      for (const [corruption, replacement] of CORRUPTIONS) {
        const damaged = withValueAt(refused, path, replacement);
        const decision = evaluatePreTradeRisk(damaged, identity, limits);
        const verified = verifyPreTradeRiskDecision(damaged, identity, limits, decision);
        if (verified.errors.length > 0) failures.push(`${label}: ${path.join(".")} = ${corruption} -> ${verified.errors.join("; ")}`);
      }
    }
  }
  assert.deepEqual(failures, [], `the two implementations disagreed under a damaged input:\n${failures.slice(0, 12).join("\n")}`);
});

test("a limit that is removed cannot silently stop being enforced", () => {
  // The mirror case: the request is fine and the POLICY loses a field. A gateway that reads a
  // missing limit as "no limit" would allow an order no operator authorised.
  const failures = [];
  for (const key of Object.keys(limits)) {
    for (const [corruption, replacement] of CORRUPTIONS) {
      const damaged = { ...limits };
      if (replacement === Symbol.for("delete")) delete damaged[key];
      else damaged[key] = replacement;
      const oversized = request();
      oversized.quantity = 10_000;
      if (evaluatePreTradeRisk(oversized, identity, damaged).status === "ALLOW") failures.push(`${key} = ${corruption}`);
    }
  }
  assert.deepEqual(failures, [], `a missing limit read as no limit:\n${failures.join("\n")}`);
});

test("every reason the evaluator can emit is one the contract declares", () => {
  const seen = new Set();
  for (const [, mutate] of REFUSED) {
    const refused = request();
    mutate(refused);
    for (const path of leafPaths(refused)) {
      for (const [, replacement] of CORRUPTIONS) {
        for (const code of evaluatePreTradeRisk(withValueAt(refused, path, replacement), identity, limits).reasonCodes) seen.add(code);
      }
    }
  }
  for (const code of seen) assert.ok(RISK_REASON_ORDER.includes(code), `undeclared reason ${code}`);
});
