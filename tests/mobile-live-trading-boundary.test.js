"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * NUSA UI/UX -- MARKET + PAPER convergence / LIVE TRADING independent tab (owner spec 2026-09-24).
 * Section 17 regression: LIVE TRADING is a reachable navigation destination with zero mutation
 * surface. Source-level assertions because this app has no component test renderer wired here;
 * this still fails on the exact regressions the spec calls out (a submit control, a real toggle
 * merging PAPER/LIVE, or the safety fields silently dropped).
 */

const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/liveTradingView.tsx"), "utf8");

test("LIVE TRADING is reachable as its own primary navigation destination, not a PAPER toggle", () => {
  assert.match(app, /const tabs = \[.*"LiveTrading".*\]/);
  assert.match(app, /activeTab === "LiveTrading" \? <LiveTradingView \/>/);
  const code = view.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /<Switch\b|onValueChange/, "LIVE must not be a toggle control inside PAPER");
});

test("LIVE TRADING always shows the disabled/authority state in plain text, not color alone", () => {
  assert.match(view, /LIVE trading is not enabled\./);
  assert.match(view, /liveAuthority = NONE/);
  assert.match(view, /productionMutationAllowed = false/);
  assert.match(view, /aiAuthority = ZERO_AUTHORITY/);
});

test("LIVE TRADING has no order submission, mutation, or credential-entry control", () => {
  for (const forbidden of [/onSubmit/i, /placeOrder/i, /submitOrder/i, /onPress=\{.*[Cc]onnect/, /TextInput/, /liveExecut/i, /withdraw/i, /transfer/i]) {
    assert.doesNotMatch(view, forbidden, `LIVE TRADING screen must not contain ${forbidden}`);
  }
});

test("LIVE TRADING does not require an active PAPER dashboard connection to render", () => {
  assert.match(app, /activeTab !== "LiveTrading"/);
});

test("Android back from LIVE TRADING returns HOME without touching session or authority", () => {
  const { resolveAndroidBackNavigation } = require("../dist/apps/mobile/src/androidBackNavigation.js");
  assert.equal(resolveAndroidBackNavigation({ paperLearningOpen: false, utilityViewOpen: false, utilityMenuOpen: false, activeTab: "LiveTrading" }), "GO_HOME");
});
