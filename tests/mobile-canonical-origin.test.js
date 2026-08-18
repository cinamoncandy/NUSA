const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeCanonicalNusaOrigin, resolvePaperEndpoint, tryNormalizeCanonicalNusaOrigin } = require("../dist/apps/mobile/src/canonicalOrigin.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical mobile origin accepts only a stable public HTTPS hostname", () => {
  assert.equal(normalizeCanonicalNusaOrigin("https://nusa.example.com/"), "https://nusa.example.com");
  assert.equal(normalizeCanonicalNusaOrigin("https://nusa.example.com:8443/"), "https://nusa.example.com:8443");
  assert.throws(() => normalizeCanonicalNusaOrigin("http://nusa.example.com"), /HTTPS/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://localhost"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://127.0.0.1"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://10.0.0.1"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://[2001:db8::1]"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://paper.internal"), /stable public hostname/);
  assert.throws(() => normalizeCanonicalNusaOrigin("https://paper.local"), /stable public hostname/);
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

test("canonical Android RC probes the public NUSA health endpoint before assembly", () => {
  const workflow = read(".github/workflows/wo-0060-canonical-android-rc.yml");
  const generator = read("scripts/prepare-mobile-build-config.js");
  assert.match(generator, /isIP/);
  assert.match(generator, /stable public hostname/);
  assert.match(workflow, /Probe canonical NUSA Cloud health/);
  assert.match(workflow, /new URL\('\/health', origin\)/);
  assert.match(workflow, /response\.status !== 200/);
  assert.match(workflow, /body\?\.ok !== true/);
  assert.ok(workflow.indexOf("Probe canonical NUSA Cloud health") < workflow.indexOf(":app:assembleRelease"));
});
