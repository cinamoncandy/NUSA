const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "mobile-native.yml"), "utf8");
const gradle = fs.readFileSync(path.join(root, "apps", "mobile", "android", "app", "build.gradle"), "utf8");

test("Android release candidates use the same protected signing boundary as stable", () => {
  assert.match(workflow, /Prepare protected Android release-candidate signing material/);
  assert.match(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEYSTORE_B64/);
  assert.match(workflow, /secrets\.NUSA_ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(workflow, /secrets\.NUSA_ANDROID_RELEASE_CERT_SHA256/);
  assert.match(workflow, /certificate mismatch/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_KEYSTORE_PATH=\$KEYSTORE_PATH/);
  assert.match(workflow, /Remove protected Android release-candidate signing material/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
});

test("release packaging still fails closed without protected signing and never falls back to debug signing", () => {
  assert.match(gradle, /NUSA_ANDROID_RELEASE_SIGNING_REQUIRED/);
  assert.match(gradle, /nusaReleaseTaskRequested && !nusaReleaseSigningReady/);
  assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
  assert.doesNotMatch(workflow, /NUSA_ANDROID_RELEASE_KEYSTORE_B64:\s*[^$]/);
});
