const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildPaperLearningScreen } = require("../dist/apps/mobile/src/paperLearningScreen.js");
const { recordLocalPaperPublicMarkets, resetLocalPaperLearningEventsForTest } = require("../dist/apps/mobile/src/localPaperLearningProjection.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const serverEvent = (overrides = {}) => ({
  id: "evt-1",
  cycleId: "cycle-1",
  stage: "MARKET_DATA",
  occurredAt: 1_700_000_000_000,
  market: "KRW-BTC",
  status: "PASS",
  ...overrides
});

// Issue #755: on a real device the PAPER learning screen was empty and gave no way to tell which
// upstream condition caused it. Each distinct cause must now be reported as itself.

test("#755: an unconfigured endpoint is reported as NOT_CONFIGURED, not as absent learning results", () => {
  resetLocalPaperLearningEventsForTest();
  const screen = buildPaperLearningScreen([], "PAUSED", "NOT_CONFIGURED");
  assert.equal(screen.dataSource, "NOT_CONFIGURED");
  assert.equal(screen.timeline.length, 0);
});

test("#755: a failed or stale operations request is reported as UNAVAILABLE", () => {
  resetLocalPaperLearningEventsForTest();
  const screen = buildPaperLearningScreen([], "PAUSED", "UNAVAILABLE");
  assert.equal(screen.dataSource, "UNAVAILABLE");
});

test("#755: a READY snapshot with no paperLearning projection is reported as PROJECTION_ABSENT", () => {
  resetLocalPaperLearningEventsForTest();
  const screen = buildPaperLearningScreen([], "PAUSED", "PROJECTION_ABSENT");
  assert.equal(screen.dataSource, "PROJECTION_ABSENT");
});

test("#755: a present-but-empty projection is reported as PROJECTION_EMPTY, distinct from absent", () => {
  resetLocalPaperLearningEventsForTest();
  const empty = buildPaperLearningScreen([], "RUNNING", "PROJECTION_EMPTY");
  const absent = buildPaperLearningScreen([], "RUNNING", "PROJECTION_ABSENT");
  assert.equal(empty.dataSource, "PROJECTION_EMPTY");
  assert.equal(absent.dataSource, "PROJECTION_ABSENT");
  assert.notEqual(empty.dataSource, absent.dataSource);
});

test("#755: real server events are reported as SERVER_STREAM", () => {
  const screen = buildPaperLearningScreen([serverEvent()], "RUNNING", "SERVER_STREAM");
  assert.equal(screen.dataSource, "SERVER_STREAM");
  assert.equal(screen.timeline.length, 1);
});

test("#755: server events always win over the on-device fallback and are labelled as server data", () => {
  // Even with a populated local projection, real server events must not be silently blended with
  // or replaced by locally-derived rows.
  recordLocalPaperPublicMarkets([{ market: "KRW-BTC", price: 100_000_000, changeRate: 0.01, volume: 10, observedAt: new Date(1_700_000_000_000).toISOString(), source: "UPBIT_PUBLIC_TICKER" }]);
  const screen = buildPaperLearningScreen([serverEvent()], "RUNNING", "SERVER_STREAM");
  assert.equal(screen.dataSource, "SERVER_STREAM");
  assert.equal(screen.timeline.length, 1);
  assert.equal(screen.timeline[0].id, "evt-1");
});

test("#755: substituting the on-device projection is disclosed as LOCAL_FALLBACK, never as server truth", () => {
  recordLocalPaperPublicMarkets([{ market: "KRW-BTC", price: 100_000_000, changeRate: 0.01, volume: 10, observedAt: new Date(1_700_000_000_000).toISOString(), source: "UPBIT_PUBLIC_TICKER" }]);
  const screen = buildPaperLearningScreen([], "RUNNING", "PROJECTION_EMPTY");
  // The rows shown are local, so the badge must say so rather than inheriting the server condition.
  if (screen.timeline.length > 0) {
    assert.equal(screen.dataSource, "LOCAL_FALLBACK");
  } else {
    assert.equal(screen.dataSource, "PROJECTION_EMPTY");
  }
});

test("#755: the monitor reports the observed condition instead of guessing from runtime status", () => {
  const view = read("apps/mobile/src/paperLearningMonitorView.tsx");
  // The reason must be selected by the explicit discriminant, not re-derived from state.status.
  assert.match(view, /switch \(state\.dataSource\)/);
  for (const source of ["NOT_CONFIGURED", "UNAVAILABLE", "PROJECTION_ABSENT"]) {
    assert.ok(view.includes(`case "${source}":`), `${source} must have its own reported reason`);
  }
  // The data source is always visible, not only when the screen happens to be empty.
  assert.match(view, /testID="paper-learning-data-source"/);
  assert.match(view, /testID="paper-learning-local-fallback-note"/);
});

test("#755: App supplies the real upstream condition rather than a placeholder", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /paperLearningServerSource/);
  assert.match(app, /operations\.status === "NOT_CONFIGURED"/);
  assert.match(app, /operations\.status === "UNAVAILABLE"/);
  assert.match(app, /snapshot\?\.paperLearning == null/);
  assert.match(app, /buildPaperLearningScreen\(snapshot\?\.paperLearning\?\.events \?\? \[\], paperLearningRuntimeStatus, paperLearningServerSource\)/);
});

test("#755: no LIVE or production-mutation authority is introduced by the data-source surface", () => {
  for (const relative of ["apps/mobile/src/paperLearningScreen.ts", "apps/mobile/src/paperLearningMonitorView.tsx"]) {
    const source = read(relative);
    for (const forbidden of ["productionMutationAllowed: true", "placeOrder", "submitOrder", "onWithdraw", "onTransfer"]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not introduce ${forbidden}`);
    }
  }
  const screen = buildPaperLearningScreen([serverEvent()], "RUNNING", "SERVER_STREAM");
  assert.equal(screen.readOnly, true);
  assert.equal(screen.mode, "PAPER");
});
