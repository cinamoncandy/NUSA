const names = ["TaskDuration", "JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"];

function selectPerformanceMetrics(response) {
  if (!response || !Array.isArray(response.metrics)) throw new Error("PERFORMANCE_METRICS_INVALID");
  const result = {};
  for (const name of names) {
    const matches = response.metrics.filter(metric => metric && metric.name === name);
    if (matches.length !== 1 || !Number.isFinite(matches[0].value) || matches[0].value < 0) throw new Error("PERFORMANCE_METRICS_INVALID");
    result[name] = matches[0].value;
  }
  return result;
}
module.exports = { selectPerformanceMetrics };
