const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const text = fs.readFileSync(".github/workflows/oracle-host-forward-records.yml", "utf8").replace(/\r\n/g, "\n");
const commands = text.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");

test("dispatch-only, read-only, secret-free, host runner", () => {
  assert.match(text, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.doesNotMatch(commands, /actions\/checkout/);
});

test("the only action is the sha-pinned first-party upload and nothing mutates the host", () => {
  const uses = commands.split("\n").filter((l) => /\buses:/.test(l));
  assert.equal(uses.length, 1);
  assert.match(uses[0], /actions\/upload-artifact@[0-9a-f]{40} # v4$/);
  for (const f of [/\bsudo\b/, /systemctl/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\bwget\b/, /\bcurl\b/, /\bkill\b/, /\.env\b/, /state\.sqlite/, /sqlite3?\b/, /(^|\s)>\s*\/(?!dev\/null)/]) {
    assert.doesNotMatch(commands, f, `forbidden: ${f}`);
  }
  assert.match(commands, /> "\$RECORDS_FILE"/);
  assert.match(text, /RECORDS_FILE: \$\{\{ runner\.temp \}\}\//);
  assert.match(text, /retention-days: 3/);
});

test("the filter keeps only the two record shapes and the window is bounded", () => {
  const script = text.split("run: |\n")[1].split("      - name: Upload")[0].replace(/^ {10}/gm, "");
  const fake = `#!/bin/sh
echo "noise line"
echo "FORWARD_QUARTER_HASH_PART 1/2 sha256=${"a".repeat(64)} {\\"rows\\":3}"
echo "FORWARD_QUARTER_HASH_PART 1/2 sha256=short {}"
echo "price KRW-BTC 123"
echo 'FORWARD_DECISION {"verdict":"PASS","n":5}'
echo "FORWARD_DECISION not braces"
`;
  const dir = fs.mkdtempSync(require("node:os").tmpdir() + "/fr-");
  fs.writeFileSync(`${dir}/journalctl`, fake, { mode: 0o755 });
  for (const n of ["ionice", "nice", "timeout"]) fs.writeFileSync(`${dir}/${n}`, '#!/bin/sh\nwhile [ "$1" != "journalctl" ]; do shift; done\nexec "$@"\n', { mode: 0o755 });
  const out = `${dir}/out.txt`;
  const run = (days) => spawnSync("bash", ["-c", script], { env: { PATH: `${dir}:${process.env.PATH}`, SINCE_DAYS: days, RECORDS_FILE: out }, encoding: "utf8" });
  const ok = run("10");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const kept = fs.readFileSync(out, "utf8").trim().split("\n");
  assert.equal(kept.length, 2);
  assert.match(kept[0], /^FORWARD_QUARTER_HASH_PART 1\/2 sha256=a{64} /);
  assert.match(kept[1], /^FORWARD_DECISION \{/);
  for (const bad of ["0", "32", "x", "", "5;id"]) assert.notEqual(run(bad).status, 0, bad);
});
