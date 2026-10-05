const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/oracle-host-diagnose.yml", "utf8");

test("the host diagnosis is dispatch-only, read-only and secret-free", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(text, /uses:/, "no third-party or repository action runs on the host");
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("no command can change the host or read credential files", () => {
  const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  for (const forbidden of [/\bsudo\b/, /systemctl\s+(restart|stop|start|enable|disable|reload|kill|mask)/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\btee\b/, /\bcurl\b/, /\bwget\b/, /\bapt\b/, /\bkill\b/, /(^|\s)>\s*\/(?!dev\/null)/, /\.env\b/, /cloud-runtime/, /(?<!-o )\bcat\b/]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
});

test("log output is bounded and redacted, and a separate concurrency group avoids the release guard", () => {
  assert.match(text, /tail -80/);
  assert.match(text, /redact\(\)/);
  assert.match(text, /\[hex\]/);
  assert.match(text, /group: oracle-host-diagnose/);
  assert.doesNotMatch(text, /group: oracle-paper-release/);
});
