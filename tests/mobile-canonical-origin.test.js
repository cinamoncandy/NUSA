const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("canonical mobile origin is build-provided and authoritative in PAPER endpoint binding", () => {
  const origin = read("apps/mobile/src/canonicalOrigin.ts");
  const session = read("apps/mobile/src/paperConnectionSession.ts");
  assert.match(origin, /CANONICAL_NUSA_ORIGIN/);
  assert.match(origin, /canonical NUSA origin must use HTTPS/);
  assert.match(origin, /trycloudflare\.com/);
  assert.match(session, /const buildConfiguredEndpoint = tryReadCanonicalNusaOrigin\(\)/);
  assert.match(session, /return buildConfiguredEndpoint \?\? normalizeEndpoint\(value\)/);
  assert.match(session, /configuredEndpoint = buildConfiguredEndpoint/);
});

test("canonical Android RC workflow generates build config before release assembly", () => {
  const workflow = read(".github/workflows/wo-0060b-canonical-android-rc.yml");
  const generator = read("scripts/prepare-mobile-build-config.js");
  assert.match(workflow, /Generate canonical mobile build configuration/);
  assert.match(workflow, /vars\.NUSA_MOBILE_API_BASE_URL/);
  assert.ok(workflow.indexOf("prepare-mobile-build-config.js") < workflow.indexOf(":app:assembleRelease"));
  assert.match(generator, /NUSA_MOBILE_API_BASE_URL/);
  assert.match(generator, /mobile release origin cannot be loopback or a temporary Quick Tunnel/);
});
