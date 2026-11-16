"use strict";
// Pure decision for the off-host health watch. Read-only: it only classifies one probe result.
// expectedState STOPPED: an answering host is the alarm (an unexpected start). RUNNING: a silent host is the alarm.
const EXPECTED = new Set(["STOPPED", "RUNNING"]);
const MAX_OBSERVATION_AGE_MS = 10 * 60 * 1000;
const EXPECTED_MODES = new Set(["COLLECT_ONLY"]);
const MAX_MARKET_EVENT_AGE_MS = 10 * 60 * 1000;

function classifyProbe(probe, nowMs) {
  if (probe === null || typeof probe !== "object") return { answering: false, reason: "NO_PROBE" };
  if (probe.httpStatus !== 200) return { answering: false, reason: `HTTP_${Number.isInteger(probe.httpStatus) ? probe.httpStatus : "NONE"}` };
  let body;
  try { body = JSON.parse(String(probe.body ?? "")); } catch { return { answering: false, reason: "BODY_NOT_JSON" }; }
  if (body === null || typeof body !== "object" || body.ok !== true) return { answering: false, reason: "OK_NOT_TRUE" };
  const observedAt = Date.parse(String(body.observedAt ?? ""));
  if (!Number.isFinite(observedAt)) return { answering: false, reason: "OBSERVED_AT_MISSING" };
  if (observedAt > nowMs + 60_000 || nowMs - observedAt > MAX_OBSERVATION_AGE_MS) return { answering: false, reason: "OBSERVED_AT_STALE" };
  return { answering: true, reason: "ANSWERING" };
}

// With expectedRunMode COLLECT_ONLY an ANSWERING host must also show the collect-only facts: the same mode, the order path not
// ready, no paper order ever counted, and market events that are not stale. Anything else is an alarm of its own (fail closed:
// a missing field is as bad as a wrong one). The fields come from the public /health allowlist (apps/cloud/src/server.ts).
function modeFacts(expectedRunMode, probe, nowMs) {
  let runtime;
  try { runtime = JSON.parse(String(probe.body ?? "")).runtime; } catch { runtime = undefined; }
  if (runtime === null || typeof runtime !== "object") return { alert: "MODE_MISMATCH", reason: "RUNTIME_MISSING" };
  if (runtime.runMode !== expectedRunMode) return { alert: "MODE_MISMATCH", reason: "RUN_MODE_NOT_EXPECTED" };
  if (runtime.orderPathReady !== false) return { alert: "ORDER_WHILE_NOT_GRANTED", reason: "ORDER_PATH_NOT_OFF" };
  if (!Number.isSafeInteger(runtime.paperOrderCount) || runtime.paperOrderCount !== 0) return { alert: "ORDER_WHILE_NOT_GRANTED", reason: "PAPER_ORDER_COUNT_NOT_ZERO" };
  if (!Number.isFinite(runtime.lastMarketEventAt) || nowMs - runtime.lastMarketEventAt > MAX_MARKET_EVENT_AGE_MS || runtime.lastMarketEventAt - nowMs > 60_000) return { alert: "EVENTS_STALE", reason: "MARKET_EVENT_STALE_OR_MISSING" };
  return { alert: "NONE", reason: "MODE_FACTS_OK" };
}

function decide(expectedState, probe, nowMs, expectedRunMode) {
  if (!EXPECTED.has(expectedState)) return { alert: "CONFIG_INVALID", reason: "expectedState must be STOPPED or RUNNING" };
  if (expectedRunMode !== undefined && (expectedState !== "RUNNING" || !EXPECTED_MODES.has(expectedRunMode))) return { alert: "CONFIG_INVALID", reason: "expectedRunMode must be COLLECT_ONLY and needs expectedState RUNNING" };
  const result = classifyProbe(probe, nowMs);
  if (expectedState === "RUNNING") {
    if (!result.answering) return { alert: "DOWN", reason: result.reason };
    return expectedRunMode === undefined ? { alert: "NONE", reason: result.reason } : modeFacts(expectedRunMode, probe, nowMs);
  }
  return result.answering ? { alert: "UNEXPECTED_UP", reason: result.reason } : { alert: "NONE", reason: result.reason };
}

module.exports = { decide, classifyProbe, MAX_OBSERVATION_AGE_MS, MAX_MARKET_EVENT_AGE_MS };

if (require.main === module) {
  const fs = require("node:fs");
  const [configPath, httpStatus, bodyPath] = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const body = bodyPath && fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, "utf8").slice(0, 100_000) : "";
  const result = decide(config.expectedState, { httpStatus: Number(httpStatus), body }, Date.now(), config.expectedRunMode);
  process.stdout.write(`${result.alert} ${result.reason}\n`);
}
