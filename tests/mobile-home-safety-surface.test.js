const test = require("node:test");
const assert = require("node:assert/strict");
const {
  homeMarketAvailability,
  homeMarketStaleLabel,
  selectHomeMarketFeed,
} = require("../dist/apps/mobile/src/homeMarketData.js");
const {
  describeHomeDecisionHeader,
  formatHomeConfidence,
  formatHomeKrw,
  formatHomeSignedKrw,
  HOME_EMPTY,
  toHomeCardProps,
} = require("../dist/apps/mobile/src/homeDecisionSurface.js");
const {
  describeHomeRisk,
  formatHomeFreshness,
} = require("../dist/apps/mobile/src/homeDashboard.js");
const {
  homeContentStyle,
  getHomeVisualProfile,
} = require("../dist/apps/mobile/src/homeVisualProfile.js");
const { homeReferenceToPrimary } = require("../dist/apps/mobile/src/mobileNavigation.js");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");

const market = (overrides = {}) => ({ market: "KRW-BTC", price: 100000000, changeRate: 0.01, ...overrides });

test("fresh public feeds are never labeled stale; snapshot fallbacks always are", () => {
  const fresh = selectHomeMarketFeed([market()], [market()], { isStale: false, connectionState: "HEALTHY" });
  assert.equal(fresh.source, "PUBLIC");
  assert.equal(fresh.isStale, false);
  assert.equal(homeMarketStaleLabel(fresh), null);
  const stalePublic = selectHomeMarketFeed([market()], [], { isStale: true, connectionState: "STALE" });
  assert.equal(homeMarketStaleLabel(stalePublic), "STALE");
  const fallback = selectHomeMarketFeed(null, [market()], { isStale: false, connectionState: "HEALTHY" });
  assert.equal(fallback.source, "SNAPSHOT");
  assert.equal(fallback.isStale, true);
  assert.equal(homeMarketStaleLabel(fallback), "STALE · snapshot");
  const none = selectHomeMarketFeed(null, [], { isStale: false, connectionState: "DOWN" });
  assert.equal(none.source, "NONE");
  assert.deepEqual(none.rows, []);
});

test("loading, empty, and ready states are distinguishable", () => {
  assert.equal(homeMarketAvailability(null), "LOADING");
  assert.equal(homeMarketAvailability([]), "EMPTY");
  assert.equal(homeMarketAvailability([market()]), "READY");
});

test("formatters never emit blank or undefined", () => {
  assert.equal(HOME_EMPTY, "—");
  assert.equal(formatHomeKrw(null), "—");
  assert.equal(formatHomeKrw(undefined), "—");
  assert.ok(formatHomeKrw(1500).includes("1,500"));
  assert.equal(formatHomeSignedKrw(null), "—");
  assert.ok(formatHomeSignedKrw(200).startsWith("+"));
  assert.ok(!formatHomeSignedKrw(-200).startsWith("+"));
  assert.equal(formatHomeConfidence(0.9, "CALIBRATED", true), "90%");
  assert.equal(formatHomeConfidence(0.9, "UNCALIBRATED", true), "—");
  assert.equal(formatHomeConfidence(0.9, "CALIBRATED", false), "—");
  assert.equal(formatHomeConfidence(null, "CALIBRATED", true), "—");
});

test("decision header and card props project the tested surface without re-deriving", () => {
  const surface = {
    attention: "WATCH",
    statusLabel: "PAPER · READY",
    statusTone: "warning",
    now: "PAPER DECISION READY",
    why: "because",
    risk: "PAPER ONLY",
    primaryLabel: "OPEN MARKET",
    primaryDetail: "detail",
    primaryAction: "MARKETS",
    aiInsightAvailable: true,
  };
  assert.deepEqual(describeHomeDecisionHeader(surface).label, "PAPER · READY · WATCH");
  assert.equal(describeHomeDecisionHeader(surface).tone, "warning");
  const card = toHomeCardProps(surface);
  assert.equal(card.judgement, "because");
  assert.equal(card.badge, "WATCH");
  assert.equal(card.tone, "warning");
  assert.equal(card.cta, "OPEN MARKET");
  assert.equal(card.action, "MARKETS");
  assert.equal(card.aiMarked, true);
  assert.ok(Object.isFrozen(card));
});

test("risk summary escalates non-PAPER modes to danger", () => {
  const base = { mode: "PAPER", aiHealth: "HEALTHY", riskLevel: "LOW" };
  assert.deepEqual(describeHomeRisk(base).tone, "info");
  assert.ok(describeHomeRisk(base).label.includes("PAPER"));
  assert.equal(describeHomeRisk({ ...base, riskLevel: "CRITICAL" }).tone, "warning");
  assert.equal(describeHomeRisk({ ...base, aiHealth: "OFFLINE" }).tone, "warning");
  assert.equal(describeHomeRisk({ ...base, mode: "LIVE" }).tone, "danger");
  assert.equal(describeHomeRisk({ ...base, mode: "FAULTED" }).tone, "danger");
});

test("freshness labels degrade explicitly", () => {
  assert.equal(formatHomeFreshness(1_000, 1_000), "LIVE");
  assert.equal(formatHomeFreshness(1_000, 4_000), "LIVE");
  assert.equal(formatHomeFreshness(1_000, 6_000), "5s ago");
  assert.equal(formatHomeFreshness(1_000, 30_000), "29s ago");
  assert.equal(formatHomeFreshness(1_000, 120_000), "STALE");
  assert.equal(formatHomeFreshness(Number.NaN, 1_000), "STALE");
  assert.equal(formatHomeFreshness(2_000, 1_000), "STALE");
});

test("reference navigation maps onto canonical tabs and profiles expose content style", () => {
  assert.equal(homeReferenceToPrimary("Home"), "HOME");
  assert.equal(homeReferenceToPrimary("Markets"), "OBSERVE");
  assert.equal(homeReferenceToPrimary("AiSignal"), "SUPERVISE");
  assert.equal(homeReferenceToPrimary("Paper"), "PAPER");
  assert.equal(homeReferenceToPrimary("Portfolio"), "SUPERVISE");
  const master = homeContentStyle(getHomeVisualProfile("master"));
  assert.equal(master.paddingHorizontal, 14);
  assert.equal(master.gap, 12);
  assert.equal(master.maxWidth, 780);
  const classic = homeContentStyle(getHomeVisualProfile("classic"));
  assert.equal(classic.paddingHorizontal, 20);
  assert.ok(Object.isFrozen(master));
});

test("AI accent and success tones never collide in any theme", () => {
  for (const mode of ["dark", "light"]) {
    for (const preset of ["master", "classic"]) {
      const theme = createTheme(mode, preset);
      assert.notEqual(theme.colors.success, theme.colors.aiSignalEnd, `${mode}/${preset}: success must differ from AI accent`);
      assert.notEqual(theme.colors.success, theme.colors.aiSignalMid, `${mode}/${preset}: success must differ from AI mid`);
    }
  }
});
