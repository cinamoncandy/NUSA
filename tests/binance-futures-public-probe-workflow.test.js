const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/binance-futures-public-probe.yml", "utf8").replace(/\r\n/g, "\n");
const commands = text.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

test("the Binance probe is dispatch-only, read-only, secret-free and runs no action", () => {
  assert.match(text, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(text, /pull_request|push:|schedule:|workflow_run|repository_dispatch/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(text, /uses:/);
  assert.match(text, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("every request is a bounded plain GET of a Binance public futures path, with no key or header", () => {
  const curls = commands.split("\n").filter((line) => /\bcurl\b/.test(line));
  assert.equal(curls.length, 1);
  assert.match(curls[0], /curl -sS -m 8 --max-filesize 65536 -o \/tmp\/nusa-binance-probe\.json /);
  assert.match(curls[0], /"https:\/\/fapi\.binance\.com\$\{path\}"/);
  assert.doesNotMatch(curls[0], /\s-(X|d|H|T|u|F|K|b|c)\s|--(data|header|upload|user|form|request|config|cookie)|Authorization|Bearer|X-MBX-APIKEY|signature/i);
  const paths = [...commands.matchAll(/"(\/fapi\/v1\/[^"]+)"/g)].map((m) => m[1].split("?")[0]);
  assert.deepEqual(paths, ["/fapi/v1/ping", "/fapi/v1/premiumIndex", "/fapi/v1/fundingRate", "/fapi/v1/klines"]);
  assert.doesNotMatch(commands, /\/fapi\/v1\/(order|batchOrders|leverage|marginType|positionSide|account|balance|listenKey)/);
});

test("no command can change the host or read credential files", () => {
  for (const forbidden of [/\bsudo\b/, /systemctl/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\btee\b/, /\bwget\b/, /\bapt\b/, /\bkill\b/, /\.env\b/, /cloud-runtime/, /(^|\s)>\s*\/(?!dev\/null)/]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
});
