const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Upbit backend source is repository-managed and loopback-only", () => {
  const server = read("services/upbit-readonly/server.js");
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /\/health/);
  assert.match(server, /\/api\/v1\/account\/summary/);
  assert.match(server, /\/api\/upbit\/accounts/);
  assert.match(server, /normalizeUpbitAccountSummary/);
  assert.match(server, /https:\/\/api\.upbit\.com\/v1\/accounts/);
  assert.match(server, /UPBIT_ACCESS_KEY/);
  assert.match(server, /UPBIT_SECRET_KEY/);
  assert.match(server, /NUSA_API_TOKEN/);
});

test("source-controlled Upbit backend exposes read-only behavior only", () => {
  const server = read("services/upbit-readonly/server.js");
  assert.match(server, /method:\s*"GET"/);
  assert.doesNotMatch(server, /placeOrder|cancelOrder|withdraw|transfer|\/v1\/orders|method:\s*"POST"|method:\s*"DELETE"/);
});

test("secret material remains environment-only", () => {
  const server = read("services/upbit-readonly/server.js");
  const envExample = read("services/upbit-readonly/.env.example");
  assert.match(server, /process\.env/);
  assert.match(envExample, /replace-with-read-only-bridge-token/);
  assert.match(envExample, /replace-with-upbit-access-key/);
  assert.match(envExample, /replace-with-upbit-secret-key/);
  assert.doesNotMatch(envExample, /eyJ[A-Za-z0-9_-]{20,}/);
});
