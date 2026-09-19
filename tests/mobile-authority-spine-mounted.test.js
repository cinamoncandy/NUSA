"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const APP = readFileSync(join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");

/**
 * The spine only does its job if it is unavoidable. A component that exists but is mounted on
 * one screen is a badge, and a badge is what this design replaced: authority state has to be
 * in the same place on every screen or the operator learns to stop looking for it.
 */

test("the authority spine is mounted once, in the app shell", () => {
  assert.equal(APP.match(/<AuthoritySpine\b/g)?.length, 1);
});

test("it sits above the screen switch, not inside a tab", () => {
  const spine = APP.indexOf("<AuthoritySpine");
  // The JSX ternary chain, not the `homeShellActive` assignment that also tests activeTab.
  const firstTabBranch = APP.indexOf(": activeTab === ");
  assert.ok(spine > 0 && firstTabBranch > 0);
  assert.ok(spine < firstTabBranch, "the spine must render before any tab-specific branch");
});

test("lamps are derived from live state, not a stored flag", () => {
  assert.match(APP, /killSwitchActive === true \? \[describeRefusal\("KILL_SWITCH_ACTIVE"\)\]/);
  assert.match(APP, /requiresDashboardConnection \? \[sessionNotLinkedRefusal\(/);
  assert.match(APP, /runtimeDegradedRefusal\(snapshot\.health === "FAIL_CLOSED"\)/);
});

test("a degraded runtime is not reported as a stale quote", () => {
  // `health` collapses kill switches, halted runtimes, offline transport and pending writes
  // into two values. Naming any one of them from that field asserts more than it carries --
  // the same error as answering a 403 with "your token expired".
  assert.doesNotMatch(APP, /health !== "HEALTHY"[\s\S]{0,120}MARKET_DATA_STALE/);
  // Staleness is measured from the snapshot's own timestamp instead.
  assert.match(APP, /snapshotGeneratedAtMs=\{snapshot\?\.generatedAt \?\? null\}/);
});

test("a lit link lamp routes to the screen that can fix it", () => {
  assert.match(APP, /onSelectGate=\{\(gate\) => \{ if \(gate === "LINK"\) goSettings\(\); \}\}/);
});
