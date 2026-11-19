"use strict";
// The dead-man check watches the Health Watch (design v5, C5). The decision is pure; the workflow stays read-only, secret-free and fixed-text.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { decideDeadman, MAX_SILENCE_MINUTES } = require("../scripts/health-watch-deadman-decide.js");

const NOW = Date.parse("2026-11-19T00:00:00Z");
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

test("a recent finished run is alive, a run older than the limit is silent, the limit itself is still alive", () => {
  assert.equal(decideDeadman(ago(5), NOW).alert, "NONE");
  assert.equal(decideDeadman(ago(MAX_SILENCE_MINUTES), NOW).alert, "NONE");
  assert.equal(decideDeadman(ago(MAX_SILENCE_MINUTES + 1), NOW).alert, "WATCH_SILENT");
  assert.equal(decideDeadman(ago(24 * 60), NOW).alert, "WATCH_SILENT");
  assert.match(decideDeadman(ago(MAX_SILENCE_MINUTES + 300), NOW).reason, /^silent_1020_minutes$/);
});

test("no finished run is an alarm, never silence", () => {
  for (const value of [undefined, null, ""]) assert.equal(decideDeadman(value, NOW).alert, "WATCH_NEVER_RAN");
});

test("unreadable input, a future run time and a bad clock or limit are configuration alarms, never silence", () => {
  assert.equal(decideDeadman("not a date", NOW).alert, "CONFIG_INVALID");
  assert.equal(decideDeadman(ago(-10), NOW).alert, "CONFIG_INVALID");
  assert.equal(decideDeadman(ago(5), Number.NaN).alert, "CONFIG_INVALID");
  for (const limit of [0, -1, Number.NaN, Infinity]) assert.equal(decideDeadman(ago(5), NOW, limit).alert, "CONFIG_INVALID", String(limit));
});

test("the workflow is read-only apart from one issue, uses no secret, no host access and no PR-controlled trigger", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "health-watch-deadman.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /permissions:\n  contents: read\n  actions: read\n  issues: write\n/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /systemctl|ssh |sudo|self-hosted/);
  assert.doesNotMatch(workflow, /^\s*(pull_request|pull_request_target|workflow_run)\s*:/m);
  assert.match(workflow, /cron: "17 \* \* \* \*"/);
  assert.match(workflow, /workflows\/health-watch\.yml\/runs\?status=completed&per_page=1/);
  // A failed decision must end in a CONFIG_INVALID alarm, not in a step failure nobody reads.
  assert.match(workflow, /\|\| RESULT="CONFIG_INVALID decision_script_failed"/);
  // The issue text is fixed: only the alert code, a short reason code and the run URL are interpolated.
  assert.match(workflow, /BODY="\$\(printf 'Dead-man result: %s \(%s\)\.\\n\\nRun: %s\\n\\n/);
});

test("the dead-man limit is longer than the measured spacing of GitHub's scheduled Health Watch runs, so an ordinary slow scheduler does not alarm", () => {
  const healthWatch = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "health-watch.yml"), "utf8");
  assert.match(healthWatch, /cron: "7,37 \* \* \* \*"/);
  // Measured gaps between scheduled runs, 2026-11-17 02:01Z .. 2026-11-18 18:47Z: 8.5 h, 8.8 h, 6.5 h, 8.2 h, 8.8 h.
  const measuredWorstGapMinutes = Math.round(8.8 * 60);
  assert.ok(MAX_SILENCE_MINUTES > measuredWorstGapMinutes * 1.3, "a clear margin over the worst measured gap");
  assert.equal(decideDeadman(ago(measuredWorstGapMinutes), NOW).alert, "NONE");
});
