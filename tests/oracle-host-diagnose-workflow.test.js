const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/oracle-host-diagnose.yml", "utf8").replace(/\r\n/g, "\n");

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
  for (const forbidden of [/\bsudo\b/, /systemctl\s+(restart|stop|start|enable|disable|reload|kill|mask)/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\btee\b/, /\bwget\b/, /\bapt\b/, /\bkill\b/, /(^|\s)>\s*\/(?!dev\/null)/, /\.env\b/, /cloud-runtime/, /(?<!-o )\bcat\b/]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
});

test("the only network request is a bounded GET of the runtime's own /health on 127.0.0.1", () => {
  const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  const curls = commands.split("\n").filter((line) => /\bcurl\b/.test(line));
  assert.equal(curls.length, 1, "exactly one request");
  assert.match(curls[0], /curl -sS -m 6 -o \/tmp\/nusa-health-probe\.txt /, "silent, 6 s timeout, response to a probe file");
  assert.match(curls[0], /http:\/\/127\.0\.0\.1:41731\/health 2>&1$/, "local /health only");
  assert.doesNotMatch(curls[0], /\s-(X|d|H|T|u|F|K|b|c)\s|--(data|header|upload|user|form|request|config|cookie)|Authorization|Bearer/, "a plain GET with no body, header, cookie or credential");
  assert.match(commands, /head -c 9000 \/tmp\/nusa-health-probe\.txt/, "output bounded");
  assert.doesNotMatch(commands, /https?:\/\/(?!127\.0\.0\.1)/, "no other address");
});

test("log output is bounded and redacted, and a separate concurrency group avoids the release guard", () => {
  assert.match(text, /tail -80/);
  assert.match(text, /redact\(\)/);
  assert.match(text, /\[hex\]/);
  assert.match(text, /group: oracle-host-diagnose/);
  assert.doesNotMatch(text, /group: oracle-paper-release/);
});

test("the diagnosis does not walk the release directory, so it cannot load the host it measures", () => {
  const commands = text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  assert.doesNotMatch(commands, /du\b[^\n]*\/opt\/nusa\/releases/, "no size walk of the 11 GB release directory");
  assert.match(commands, /ls -1 \/opt\/nusa\/releases[^\n]*wc -l/, "the release directories are only counted");
});
