const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/futures-history-freeze.yml", "utf8").replace(/\r\n/g, "\n");
const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

test("the history freeze is dispatch-only, secret-free and runs no repository checkout or third-party action", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(text, /uses:/);
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("it runs only the deployed reviewed script, writes only a per-run temp directory that it removes, and cannot touch state or credentials", () => {
  assert.match(commands, /script=\/opt\/nusa\/current\/scripts\/fetch-futures-history\.js/);
  assert.match(commands, /mktemp -d "\$RUNNER_TEMP\/futures-history\.XXXXXX"/);
  assert.match(commands, /trap 'rm -rf "\$dir"' EXIT/);
  assert.equal((commands.match(/\brm\b/g) || []).length, 1, "the only rm is the trap on the temp directory");
  for (const forbidden of [/\bsudo\b/, /systemctl/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\bcurl\b/, /\bwget\b/, /\.env\b/, /\/var\/lib\/nusa/, /\/var\/backups/, /cloud-runtime/, /Authorization|X-MBX-APIKEY|api[_-]?key/i]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
  assert.match(commands, /ionice -c3 nice -n19 node "\$script" "\$dir"/, "lowest priority on the shared 1-vCPU host");
});

test("the manifest is published as a bounded annotation and the exit status is the script's", () => {
  assert.match(commands, /\$\{out:0:3500\}/);
  assert.match(commands, /::notice title=futures-history-manifest status=\$\{status\}::/);
  assert.match(commands, /exit "\$status"/);
});
