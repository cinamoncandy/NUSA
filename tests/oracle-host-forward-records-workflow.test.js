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
  assert.match(text, /        env:\n          RECORDS_FILE: \$\{\{ runner\.temp \}\}\//, "runner context only at step level");
  assert.doesNotMatch(text.split("    steps:")[0], /runner\./, "runner context is not available in job-level env");
  assert.match(text, /retention-days: 3/);
});

function runStep(journal, days, { exitCode = 0 } = {}) {
  const script = text.split("run: |\n")[1].split("      - name: Upload")[0].replace(/^ {10}/gm, "");
  const dir = fs.mkdtempSync(require("node:os").tmpdir() + "/fr-");
  fs.writeFileSync(`${dir}/journal.txt`, journal);
  fs.writeFileSync(`${dir}/journalctl`, `#!/bin/sh\ncat "${dir}/journal.txt"\nexit ${exitCode}\n`, { mode: 0o755 });
  for (const n of ["ionice", "nice", "timeout"]) fs.writeFileSync(`${dir}/${n}`, '#!/bin/sh\nwhile [ "$1" != "journalctl" ]; do shift; done\nexec "$@"\n', { mode: 0o755 });
  const out = `${dir}/out.txt`;
  const r = spawnSync("bash", ["-c", script], { env: { PATH: `${dir}:${process.env.PATH}`, SINCE_DAYS: days, RECORDS_FILE: out }, encoding: "utf8" });
  return { ...r, kept: fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean) : [] };
}
const H = "a".repeat(64);
const part = (i, n, body) => `FORWARD_QUARTER_HASH_PART ${i}/${n} sha256=${H} ${body}\n`;

test("keeps only the two record shapes (including non-ASCII and a 30,000-character chunk) and the window is bounded", () => {
  const big = "x".repeat(30000);
  const r = runStep(`noise\n${part(1, 2, '{"rows":3}')}${part(2, 2, big)}FORWARD_QUARTER_HASH_PART 1/2 sha256=short {}\nprice KRW-BTC 123\nFORWARD_DECISION {"verdict":"PASS","reason":"한글"}\nFORWARD_DECISION not braces\n`, "10");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.kept.length, 3);
  assert.equal(r.kept[1].length, `FORWARD_QUARTER_HASH_PART 2/2 sha256=${H} `.length + 30000);
  assert.match(r.kept[2], /한글/);
  assert.match(r.stdout, /complete/);
  for (const bad of ["0", "32", "x", "", "5;id", "99999999999999999999", "001"]) assert.notEqual(runStep(part(1, 1, "{}"), bad).status, 0, bad);
});

test("fails loudly on a journal error, an empty result, a missing part or a lone EXIT line", () => {
  assert.notEqual(runStep(part(1, 1, "{}"), "10", { exitCode: 1 }).status, 0, "journalctl failed");
  const empty = runStep("", "10");
  assert.notEqual(empty.status, 0);
  assert.match(empty.stdout, /NO_RECORD_LINES/);
  const gap = runStep(part(1, 3, "{}") + part(3, 3, "{}"), "10");
  assert.notEqual(gap.status, 0);
  assert.match(gap.stdout, /INCOMPLETE_PARTS/);
  assert.equal(runStep("EXIT=0\n" + part(1, 1, "{}"), "10").status, 0, "a journal line reading EXIT=0 cannot spoof the exit code and does not break the file");
  assert.notEqual(runStep(part(1, 1, "{}").trimEnd() + "\nEXIT=0", "10", { exitCode: 3 }).status, 0, "a spoofed EXIT=0 cannot hide a failing journalctl");
});
