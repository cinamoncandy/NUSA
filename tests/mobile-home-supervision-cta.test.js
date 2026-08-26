const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const home = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");

test("HOME routes degraded PAPER runtime states to supervision before market or signal exploration", () => {
  assert.match(home, /const runtimeNeedsSupervision = runtimeState === "HALTED" \|\| runtimeState === "ERROR" \|\| runtimeState === "DEGRADED" \|\| runtimeState === "STOPPED" \|\| runtimeState === "STOPPING"/);
  assert.match(home, /runtimeNeedsSupervision \? "SUPERVISE PAPER"/);
  assert.match(home, /if \(runtimeNeedsSupervision\) return onNavigate\("Portfolio"\)/);
  assert.match(home, /현재 PAPER runtime 상태와 계좌 결과를 먼저 감독합니다/);
});
