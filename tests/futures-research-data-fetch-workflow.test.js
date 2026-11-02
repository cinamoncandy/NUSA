const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/futures-research-data-fetch.yml", "utf8").replace(/\r\n/g, "\n");
const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

test("dispatch-only from main, read-only token, no secrets, on the PAPER host", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.match(text, /persist-credentials: false/);
});

test("the only command runs the reviewed fetch script into the runner's temp directory", () => {
  const runs = commands.split("\n").filter((line) => /^\s{10}node /.test(line));
  assert.deepEqual(runs.map((line) => line.trim()), ['node scripts/futures-research-fetch.js "$RUNNER_TEMP/futures-research-data"']);
  for (const forbidden of [/\bcurl\b/, /\bwget\b/, /\bsudo\b/, /systemctl/, /\brm\b/, /\.env\b/, /\/var\/lib\/nusa/, /\/opt\/nusa/]) assert.doesNotMatch(commands, forbidden);
});

test("only pinned checkout and upload-artifact actions are used", () => {
  const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["actions/checkout@11d5960a326750d5838078e36cf38b85af677262", "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"]);
});
