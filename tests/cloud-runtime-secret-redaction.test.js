const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { start } = require("../scripts/start-cloud-runtime.js");

test("cloud runtime banner never prints the dashboard token", () => {
  const secret = "sensitive-dashboard-token-" + "x".repeat(48);
  let output = "";
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};

  start({
    env: {},
    resolveToken: () => secret,
    write: (text) => { output += text; },
    spawn: () => child,
  });

  assert.equal(output.includes(secret), false);
  assert.match(output, /token\s+\[redacted\]/);
  assert.match(output, /token from the token file/);
});
