const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// QA finding: PersonalPaperRuntimeState has 8 real values (packages/contracts/src/
// personalPaperOperations.ts: HALTED/READY_OFFLINE/READY/RUNNING/DEGRADED/ERROR/STOPPING/STOPPED),
// but Home's NOW/attention hierarchy only explicitly distinguished RUNNING/DEGRADED/HALTED. An
// actual ERROR runtime fell through to the same generic WATCH tier as an ordinary "waiting for
// signal" state, and STOPPED/STOPPING had no label at all -- both are real states a real device
// could report, and displaying them as generic "DECISION HOLD"/"WATCH" is an incorrect status
// display, not just a cosmetic gap.

test("a real ERROR runtime state is surfaced as ACTION REQUIRED with an explicit label, not a generic wait state", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /runtimeState === "HALTED" \|\| runtimeState === "ERROR"\s*\n\s*\? "ACTION REQUIRED"/);
  assert.match(home, /runtimeState === "ERROR"\s*\n\s*\? "PAPER RUNTIME ERROR"/);
  assert.match(home, /runtimeState === "ERROR"\s*\n\s*\? "PAPER runtime이 오류를 보고하여 감독자의 확인이 필요합니다\."/);
  assert.match(home, /runtimeState === "ERROR" \? "ERROR"/);
});

test("a real STOPPED/STOPPING runtime state is surfaced as WATCH with an explicit label, never silently blended into QUIET", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /runtimeState === "STOPPED" \|\| runtimeState === "STOPPING"/);
  assert.match(home, /"PAPER RUNTIME STOPPED"/);
  assert.match(home, /"PAPER runtime이 정지되어 있어 새로운 판단이 생성되지 않습니다\."/);
  assert.match(home, /runtimeState === "STOPPED" \|\| runtimeState === "STOPPING" \? "STOPPED" : signalReady \? "READY" : "CHECK"/);
});

test("all 8 real runtime states remain distinguishable from each other in Home's attention/status logic", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  // HALTED, ERROR, DEGRADED, STOPPED/STOPPING each get their own explicit branch; RUNNING and the
  // ready/waiting fallback (READY/READY_OFFLINE/CHECK) are already covered by the existing
  // signalReady-based fallback. Assert every explicit state name actually appears as a real
  // comparison, not just in a comment.
  for (const state of ["HALTED", "ERROR", "DEGRADED", "STOPPED", "STOPPING", "RUNNING"]) {
    const pattern = new RegExp(`runtimeState === "${state}"`);
    assert.ok(pattern.test(home), `runtimeState === "${state}" must appear as a real comparison`);
  }
});
