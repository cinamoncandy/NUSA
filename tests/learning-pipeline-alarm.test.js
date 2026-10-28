const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { LearningPipelineAlarmTracker, LEARNING_PIPELINE_ALARM_BOUND_MS } = require("../dist/apps/cloud/src/learningPipelineAlarm.js");
const { learningPipelineProjection } = require("../dist/apps/cloud/src/learningPipelineStage.js");
const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");

const T0 = 1_792_990_000_000;
const HOUR = 3_600_000;
const projection = (trading, research = "PASS", learning = "PASS") => ({ trading: { code: trading }, research: { code: research }, learning });

test("an unchanged stop code raises one alarm after the bound, and PASS clears it", () => {
  const lines = [];
  const tracker = new LearningPipelineAlarmTracker(6 * HOUR, (line) => lines.push(line));
  assert.equal(tracker.update(projection("ORDER_INTENT_FAILING"), T0).trading.alarm, false);
  assert.equal(tracker.update(projection("ORDER_INTENT_FAILING"), T0 + 6 * HOUR - 1).trading.alarm, false);
  const raised = tracker.update(projection("ORDER_INTENT_FAILING"), T0 + 6 * HOUR);
  assert.deepEqual(raised.trading, { code: "ORDER_INTENT_FAILING", sinceMs: T0, alarm: true });
  tracker.update(projection("ORDER_INTENT_FAILING"), T0 + 7 * HOUR);
  assert.deepEqual(lines, [`[learning-pipeline-alarm] TRADING ORDER_INTENT_FAILING sinceMs=${T0}`], "the journal line is written once");
  const cleared = tracker.update(projection("PASS"), T0 + 8 * HOUR);
  assert.deepEqual(cleared.trading, { code: "PASS", alarm: false });
  assert.equal(lines.at(-1), "[learning-pipeline-alarm] TRADING CLEARED");
});

test("a different stop code restarts the clock; branches are tracked separately; a throwing log cannot break it", () => {
  const tracker = new LearningPipelineAlarmTracker(HOUR, () => { throw new Error("log down"); });
  tracker.update(projection("ORDER_NONE", "CANDLES_STALE"), T0);
  const later = tracker.update(projection("FILL_NONE", "CANDLES_STALE"), T0 + HOUR);
  assert.deepEqual(later.trading, { code: "FILL_NONE", sinceMs: T0 + HOUR, alarm: false });
  assert.deepEqual(later.research, { code: "CANDLES_STALE", sinceMs: T0, alarm: true });
  assert.equal(later.learning.code, "PASS");
  assert.equal(LEARNING_PIPELINE_ALARM_BOUND_MS, 6 * HOUR);
});

test("UNKNOWN evidence is tracked like any other non-PASS code (fail closed)", () => {
  const tracker = new LearningPipelineAlarmTracker(HOUR, () => {});
  const p = learningPipelineProjection({}, T0);
  tracker.update(p, T0);
  assert.equal(tracker.update(p, T0 + HOUR).trading.alarm, true);
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: { connection: "close" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

test("/health carries learningPipeline and learningPipelineAlarm only when a liveness source exists", async () => {
  const base = { tokenVerifier: { verify: () => undefined }, loadDashboard: () => { throw new Error("not used"); } };
  const liveness = { startedAt: T0, lastHeartbeatAt: T0, lastMarketEventAt: Date.now(), lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null,
    eventCount: 5, decisionCount: 3, paperOrderCount: 0, paperFillCount: 0, lastError: null, secretBalance: 123456 };
  const withSource = startCloudDashboardServer({ ...base, port: 41000 + Math.floor(Math.random() * 900), runtimeLiveness: () => liveness });
  const without = startCloudDashboardServer({ ...base, port: 42000 + Math.floor(Math.random() * 900) });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const body = await get(withSource.port, "/health");
    assert.equal(body.learningPipeline.trading.code, "ORDER_NONE");
    assert.equal(body.learningPipelineAlarm.trading.alarm, false);
    assert.doesNotMatch(JSON.stringify(body), /secretBalance|123456/, "nothing outside the public runtime object");
    assert.equal(withSource.observeLearningPipeline().trading.code, "ORDER_NONE");
    const bare = await get(without.port, "/health");
    assert.equal("learningPipeline" in bare, false);
    assert.equal("learningPipelineAlarm" in bare, false);
    assert.equal(without.observeLearningPipeline(), undefined);
  } finally {
    await withSource.stop();
    await without.stop();
  }
});
