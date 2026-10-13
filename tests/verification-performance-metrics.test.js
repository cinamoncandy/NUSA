const test = require("node:test");
const assert = require("node:assert/strict");
const { selectPerformanceMetrics } = require("./e2e/performance-metrics");
const names = ["TaskDuration", "JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"];
const valid = () => ({ metrics: names.map(name => ({ name, value: 1 })) });

test("performance evidence retains only fixed numeric fields", () => {
  const response = valid();
  response.metrics.push({ name: "PRIVATE_VALUE", value: "secret" });
  assert.deepEqual(selectPerformanceMetrics(response), Object.fromEntries(names.map(name => [name, 1])));
});
test("missing, duplicate, negative and nonfinite observations fail closed", () => {
  for (const response of [null, {}, { metrics: [] }, { metrics: [...valid().metrics, { name: names[0], value: 1 }] }]) {
    assert.throws(() => selectPerformanceMetrics(response), /PERFORMANCE_METRICS_INVALID/);
  }
  for (const value of [-1, Infinity, NaN, "1"]) {
    const response = valid(); response.metrics[0].value = value;
    assert.throws(() => selectPerformanceMetrics(response), /PERFORMANCE_METRICS_INVALID/);
  }
});
