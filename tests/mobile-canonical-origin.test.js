const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCanonicalNusaOrigin, resolvePaperEndpoint, tryNormalizeCanonicalNusaOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");

test("canonical mobile origin accepts only a stable HTTPS origin", () => {
  assert.equal(normalizeCanonicalNusaOrigin("https://nusa.example.com/"), "https://nusa.example.com");
  assert.equal(normalizeCanonicalNusaOrigin("https://nusa.example.com:8443/"), "https://nusa.example.com:8443");
  assert.throws(() => normalizeCanonicalNusaOrigin("http://nusa.example.com"), /HTTPS/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://localhost"), /loopback/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://127.0.0.1"), /loopback/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://demo.trycloudflare.com"), /Quick Tunnel/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://user:secret@nusa.example.com"), /credentials/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://nusa.example.com/api"), /path state/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://nusa.example.com/?x=1"), /path state/);
});

test("release canonical origin overrides personal endpoint while development fallback remains available", () => {
  assert.equal(resolvePaperEndpoint("https://personal.example.com", ""), "https://personal.example.com");
  assert.equal(resolvePaperEndpoint("https://personal.example.com", "https://canonical.example.com/"), "https://canonical.example.com");
  assert.throws(() => resolvePaperEndpoint("https://personal.example.com", "http://canonical.example.com"), /HTTPS/);
  assert.equal(tryNormalizeCanonicalNusaOrigin(""), null);
  assert.equal(tryNormalizeCanonicalNusaOrigin("https://canonical.example.com/"), "https://canonical.example.com");
  assert.equal(tryNormalizeCanonicalNusaOrigin("http://canonical.example.com"), null);
});
