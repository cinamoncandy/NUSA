const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("scripts/start-cloud-runtime.js", "utf8");

test("production cloud runtime entrypoint is supervised", () => {
  assert.match(source, /function runManaged\(/);
  assert.match(source, /new PaperRuntimeProcessSupervisor\(/);
  assert.match(source, /if \(require\.main === module\) runManaged\(\);/);
});

test("supervisor child marker prevents recursive supervisor nesting", () => {
  assert.match(source, /NUSA_PAPER_RUNTIME_SUPERVISOR_CHILD/);
  assert.match(source, /baseEnv\[SUPERVISOR_CHILD_ENV\] === "true"\) return start\(options\)/);
  assert.match(source, /\[SUPERVISOR_CHILD_ENV\]: "true"/);
});

test("production supervision preserves PAPER-only launcher authority", () => {
  assert.match(source, /NUSA_MODE:\s*"PAPER"/);
  assert.match(source, /NUSA_LIVE_MUTATION:\s*"PROHIBITED"/);
  assert.match(source, /stripPrivateExchangeCredentials/);
  assert.match(source, /runManaged,/);
  assert.match(source, /start,/);
});
