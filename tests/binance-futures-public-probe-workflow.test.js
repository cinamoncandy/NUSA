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
  assert.match(curls[0], /curl -sS -m 8 --max-filesize 65536 -o "\$probe" /);
  assert.match(curls[0], /"https:\/\/fapi\.binance\.com\$\{path\}"/);
  assert.doesNotMatch(curls[0], /\s-(X|d|H|T|u|F|K|b|c)\s|--(data|header|upload|user|form|request|config|cookie)|Authorization|Bearer|X-MBX-APIKEY|signature/i);
  const paths = [...commands.matchAll(/"(\/fapi\/v1\/[^"]+)"/g)].map((m) => m[1].split("?")[0]);
  assert.deepEqual(paths, ["/fapi/v1/ping", "/fapi/v1/premiumIndex", "/fapi/v1/fundingRate", "/fapi/v1/klines"]);
  assert.doesNotMatch(commands, /\/fapi\/v1\/(order|batchOrders|leverage|marginType|positionSide|account|balance|listenKey)/);
});

test("each request writes to a fresh per-run file that is emptied first, and a no-response request prints no stale body", () => {
  assert.match(commands, /probe="\$\(mktemp \/tmp\/nusa-binance-probe\.XXXXXX\)" \|\| exit 1/);
  assert.match(commands, /trap 'rm -f "\$probe"' EXIT/);
  const loop = commands.slice(commands.indexOf("for path in"));
  assert.ok(loop.indexOf(': > "$probe"') >= 0 && loop.indexOf(': > "$probe"') < loop.indexOf("curl "), "emptied before every request");
  assert.match(loop, /if \[ "\$\{code:-000\}" = "000" \] \|\| \[ "\$size" = "0" \]; then echo "\(no response body\)"; continue; fi/);
  assert.match(loop, /curl_exit=\$\{exit_code\}/);
});

test("no command can change the host or read credential files", () => {
  const rms = commands.split("\n").filter((line) => /\brm\b/.test(line));
  assert.deepEqual(rms.map((line) => line.trim()), [`trap 'rm -f "$probe"' EXIT`], "the only removal is the probe's own mktemp file");
  for (const forbidden of [/\bsudo\b/, /systemctl/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\btee\b/, /\bwget\b/, /\bapt\b/, /\bkill\b/, /\.env\b/, /cloud-runtime/, /(^|\s)>\s*\/(?!dev\/null)/]) {
    assert.doesNotMatch(commands, forbidden, `forbidden: ${forbidden}`);
  }
});
