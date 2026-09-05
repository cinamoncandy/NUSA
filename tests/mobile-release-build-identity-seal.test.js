const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const gradle = fs.readFileSync("apps/mobile/android/app/build.gradle", "utf8");

test("Android release requires an exact source SHA identity", () => {
  assert.match(gradle, /nusaReleaseTaskRequested && !\(nusaBuildSha ==~ \/\^\[0-9a-fA-F\]\{40\}\$\/\)/);
  assert.match(gradle, /NUSA_BUILD_SHA_REQUIRED_FOR_RELEASE/);
});

test("Android release requires a positive build number identity", () => {
  assert.match(gradle, /nusaReleaseTaskRequested && nusaBuildNumber < 1/);
  assert.match(gradle, /NUSA_BUILD_NUMBER_REQUIRED_FOR_RELEASE/);
});

test("Android debug builds retain development identity fallback", () => {
  assert.match(gradle, /NUSA_BUILD_SHA\"\) \?: \"dev\"/);
  assert.match(gradle, /NUSA_BUILD_NUMBER\"\) \?: \"0\"/);
  assert.doesNotMatch(gradle, /nusaReleaseTaskRequested\s*=\s*false/);
});
