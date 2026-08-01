const test = require("node:test");
const assert = require("node:assert/strict");
const { RuntimeMetricsCollector } = require("../dist/apps/execution/src/runtime-metrics.js");

test("runtime metrics are bounded and reject non-monotonic samples", () => {
  const collector = new RuntimeMetricsCollector(3);
  collector.record({ observedAtMs: 1, rssBytes: 10, heapUsedBytes: 5, cpuUserMicros: 1, cpuSystemMicros: 1 });
  collector.record({ observedAtMs: 2, rssBytes: 11, heapUsedBytes: 5, cpuUserMicros: 2, cpuSystemMicros: 1 });
  collector.record({ observedAtMs: 3, rssBytes: 12, heapUsedBytes: 5, cpuUserMicros: 3, cpuSystemMicros: 1 });
  collector.record({ observedAtMs: 4, rssBytes: 13, heapUsedBytes: 5, cpuUserMicros: 4, cpuSystemMicros: 1 });
  assert.equal(collector.list().length, 3);
  assert.throws(() => collector.record({ observedAtMs: 3, rssBytes: 1, heapUsedBytes: 1, cpuUserMicros: 1, cpuSystemMicros: 1 }), /non-monotonic/);
});

test("runtime health stays unknown until sampled and flags monotonic heap growth", () => {
  const collector = new RuntimeMetricsCollector();
  assert.equal(collector.health().status, "UNKNOWN");
  for (const [time, heap] of [[1, 10], [2, 12], [3, 14]]) collector.record({ observedAtMs: time, rssBytes: 1, heapUsedBytes: heap, cpuUserMicros: time, cpuSystemMicros: 0 });
  assert.equal(collector.health().status, "WARNING");
  assert.equal(collector.health().memoryGrowthBytes, 4);
});
