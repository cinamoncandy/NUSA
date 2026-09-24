"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Owner UI/UX spec 2026-09-24, slice 2: MARKET + PAPER converge into one TRADING destination. */
const app = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/App.tsx"), "utf8");
const workspace = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/tradingWorkspace.tsx"), "utf8");

test("primary navigation has one TRADING destination instead of separate MARKETS and PAPER tabs", () => {
  assert.match(app, /const tabs = \["Home", "Trading", "LiveTrading", "Portfolio", "AiSignal"\] as const/);
  assert.doesNotMatch(app, /const tabs = \[[^\]]*"Markets"/);
  assert.doesNotMatch(app, /const tabs = \[[^\]]*"Paper"/);
});

test("TRADING reaches both existing screens without new implementations", () => {
  assert.match(app, /activeTab === "Markets" \? <TradingWorkspace section="Markets" onSectionChange=\{setActiveTab\}><MarketsView /);
  assert.match(app, /activeTab === "Paper" \? <TradingWorkspace section="Paper" onSectionChange=\{setActiveTab\}><TradingView /);
});

test("existing Markets/Paper routes stay reachable (deep links, openPaperTrade)", () => {
  assert.match(app, /type Tab = PrimaryTab \| TradingSection \| "Order"/);
  assert.match(app, /setActiveTab\("Paper"\)/);
});

test("LIVE is not a TRADING section and TRADING adds no LIVE authority", () => {
  assert.match(workspace, /export type TradingSection = "Markets" \| "Paper";/);
  assert.doesNotMatch(workspace, /key: "Live/);
  for (const forbidden of [/liveExecut/i, /placeOrder/i, /submitOrder/i, /TextInput/]) assert.doesNotMatch(workspace, forbidden);
});

test("Android back from a TRADING section returns HOME", () => {
  const { resolveAndroidBackNavigation } = require("../dist/apps/mobile/src/androidBackNavigation.js");
  for (const activeTab of ["Markets", "Paper"]) {
    assert.equal(resolveAndroidBackNavigation({ paperLearningOpen: false, utilityViewOpen: false, utilityMenuOpen: false, activeTab }), "GO_HOME");
  }
});
