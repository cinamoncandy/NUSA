const test = require("node:test");
const assert = require("node:assert/strict");
const { PRIMARY_MOBILE_TABS, MORE_NAVIGATION_ITEMS, GLOBAL_NAVIGATION_ACTIONS, createMobileNavigationState, restoreMobileNavigationState } = require("../dist/apps/mobile/src/mobileNavigation.js");
const { buildMobileAppShell } = require("../dist/apps/mobile/src/mobileAppShell.js");

test("primary navigation has four supervision jobs and global actions", () => {
  assert.deepEqual(PRIMARY_MOBILE_TABS, ["HOME", "OBSERVE", "PAPER", "SUPERVISE"]);
  assert.ok(MORE_NAVIGATION_ITEMS.includes("SETTINGS"));
  assert.ok(GLOBAL_NAVIGATION_ACTIONS.includes("EMERGENCY_STOP"));
});

test("legacy control/settings routes normalize without creating extra primary tabs", () => {
  const dashboard = { phase: "READY", headline: "ready", canTrade: true };
  assert.equal(buildMobileAppShell({ session: "SIGNED_IN", activeTab: "CONTROL", dashboard, now: 1 }).activeTab, "PAPER");
  assert.equal(buildMobileAppShell({ session: "SIGNED_IN", activeTab: "SETTINGS", dashboard, now: 1 }).activeTab, "MORE");
});

test("secondary navigation is at most two levels and restores memory", () => {
  const state = createMobileNavigationState({ activeTab: "MORE", searchQuery: "BTC", selectedMarket: "KRW-BTC", scrollPositions: { MORE: 120 } }, "SETTINGS");
  assert.equal(state.depth, 2);
  assert.equal(state.memory.searchQuery, "BTC");
  assert.equal(restoreMobileNavigationState(state.memory).activeTab, "MORE");
  assert.throws(() => createMobileNavigationState({ activeTab: "HOME" }, "SETTINGS"), /requires More/);
});

