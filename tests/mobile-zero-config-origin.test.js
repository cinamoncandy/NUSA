const test = require("node:test");
const assert = require("node:assert/strict");
const { readCanonicalNusaOrigin, assertReleaseCanonicalNusaOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");

test("canonical origin accepts only a stable HTTPS origin", () => {
  assert.equal(readCanonicalNusaOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://nusa.example/" }), "https://nusa.example");
  assert.throws(() => readCanonicalNusaOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "http://nusa.example" }), /HTTPS/);
  assert.throws(() => readCanonicalNusaOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://localhost" }), /loopback/);
  assert.throws(() => readCanonicalNusaOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://demo.trycloudflare.com" }), /Quick Tunnel/);
  assert.throws(() => readCanonicalNusaOrigin({ EXPO_PUBLIC_NUSA_API_BASE_URL: "https://nusa.example/api" }), /origin/);
});

test("release canonical origin is fail-closed when omitted", () => {
  assert.throws(() => assertReleaseCanonicalNusaOrigin({}), /required/);
});
