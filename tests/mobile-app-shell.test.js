const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMobileAppShell } = require("../dist/apps/mobile/src/mobileAppShell.js");

const dashboard = (phase, overrides = {}) => ({
  phase,
  headline: "status",
  canTrade: phase === "READY",
  ...overrides
});

test("routes signed-out users to auth and disables controls", () => {
  const state = buildMobileAppShell({
    session: "SIGNED_OUT",
    activeTab: "CONTROL",
    dashboard: dashboard("READY"),
    now: 100
  });
  assert.equal(state.route, "AUTH");
  assert.equal(state.activeTab, "HOME");
  assert.equal(state.canRefresh, false);
  assert.equal(state.canOpenTradingControl, false);
  assert.equal(state.showEmergencyStop, false);
});

test("shows expiry warning without exposing app controls", () => {
  const state = buildMobileAppShell({
    session: "EXPIRED",
    activeTab: "HOME",
    dashboard: dashboard("READY"),
    now: 100
  });
  assert.equal(state.route, "AUTH");
  assert.equal(state.banner.tone, "WARNING");
});

test("keeps loading state fail closed", () => {
  const state = buildMobileAppShell({
    session: "SIGNED_IN",
    activeTab: "HOME",
    dashboard: dashboard("LOADING"),
    now: 100
  });
  assert.equal(state.route, "APP");
  assert.equal(state.canRefresh, false);
  assert.equal(state.canOpenTradingControl, false);
  assert.equal(state.showEmergencyStop, false);
  assert.equal(state.banner.tone, "INFO");
});

test("allows navigation and emergency stop on ready dashboard", () => {
  const state = buildMobileAppShell({
    session: "SIGNED_IN",
    activeTab: "SUPERVISE",
    dashboard: dashboard("READY"),
    lastSuccessfulSyncAt: 99,
    now: 100
  });
  assert.equal(state.title, "감독");
  assert.equal(state.canRefresh, true);
  assert.equal(state.canOpenTradingControl, true);
  assert.equal(state.showEmergencyStop, true);
  assert.equal(state.lastSuccessfulSyncAt, 99);
});

test("surfaces blocked and error dashboards as danger banners", () => {
  const blocked = buildMobileAppShell({
    session: "SIGNED_IN",
    activeTab: "CONTROL",
    dashboard: dashboard("BLOCKED", { message: "Kill switch active" }),
    now: 100
  });
  assert.equal(blocked.banner.tone, "DANGER");
  assert.equal(blocked.showEmergencyStop, true);

  const error = buildMobileAppShell({
    session: "SIGNED_IN",
    activeTab: "HOME",
    dashboard: dashboard("ERROR", { message: "network failure" }),
    now: 100
  });
  assert.equal(error.canOpenTradingControl, false);
  assert.equal(error.showEmergencyStop, false);
  assert.equal(error.banner.message, "network failure");
});

test("rejects future sync timestamps", () => {
  assert.throws(() => buildMobileAppShell({
    session: "SIGNED_IN",
    activeTab: "HOME",
    dashboard: dashboard("READY"),
    lastSuccessfulSyncAt: 101,
    now: 100
  }), /lastSuccessfulSyncAt is invalid/);
});
