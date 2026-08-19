const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCanonicalNusaOrigin, resolvePaperEndpoint, tryNormalizeCanonicalNusaOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");

test("canonical mobile origin accepts only a stable public HTTPS hostname", () => {
  assert.equal(normalizeCanonicalNusaOrigin("https://nusa.example.com/"), "https://nusa.example.com");
  assert.throws(() => normalizeCanonicalNusaOrigin("http://nusa.example.com"), /HTTPS/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://localhost"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://127.0.0.1"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://demo.trycloudflare.com"), /Quick Tunnel/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://nusa.example.com/api"), /path state/);
});

test("release canonical origin overrides personal endpoint", () => {
  assert.equal(resolvePaperEndpoint("https://personal.example.com", ""), "https://personal.example.com");
  assert.equal(resolvePaperEndpoint("https://personal.example.com", "https://canonical.example.com/"), "https://canonical.example.com");
  assert.equal(tryNormalizeCanonicalNusaOrigin("http://canonical.example.com"), null);
});
