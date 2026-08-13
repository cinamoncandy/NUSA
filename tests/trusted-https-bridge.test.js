"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCloudflaredArgs,
  parsePort,
  resolveCloudflaredBinary,
  startBridge
} = require("../scripts/start-trusted-https-bridge.js");

test("bridge targets loopback only and never embeds credentials", () => {
  const args = buildCloudflaredArgs(43123);
  assert.deepEqual(args, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:43123"]);
  assert.equal(args.join(" ").includes("token"), false);
  assert.equal(args.join(" ").includes("0.0.0.0"), false);
});

test("port validation is fail closed", () => {
  assert.equal(parsePort("43123"), 43123);
  for (const value of [undefined, "", "80", "70000", "abc", "43123.5"]) {
    assert.throws(() => parsePort(value));
  }
});

test("cloudflared binary override is explicit", () => {
  assert.equal(resolveCloudflaredBinary({}), "cloudflared");
  assert.equal(resolveCloudflaredBinary({ NUSA_CLOUDFLARED_BIN: " C:\\tools\\cloudflared.exe " }), "C:\\tools\\cloudflared.exe");
});

test("launcher passes no bearer secret in argv", () => {
  let captured;
  const fakeChild = { on() {} };
  const fakeSpawn = (binary, args, options) => {
    captured = { binary, args, options };
    return fakeChild;
  };
  startBridge({
    NUSA_CLOUD_DASHBOARD_PORT: "43123",
    NUSA_CLOUD_DASHBOARD_TOKEN: "super-secret-bearer-value"
  }, fakeSpawn);
  assert.equal(captured.binary, "cloudflared");
  assert.deepEqual(captured.args, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:43123"]);
  assert.equal(captured.args.join(" ").includes("super-secret-bearer-value"), false);
  assert.equal(captured.options.shell, false);
});
