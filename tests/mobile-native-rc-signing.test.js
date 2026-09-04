const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "mobile-native.yml"), "utf8");
const stableWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "android-stable-release.yml"), "utf8");
const gradle = fs.readFileSync(path.join(root, "apps", "mobile", "android", "app", "build.gradle"), "utf8");

test("Android release candidates verify the protected signing boundary without reading signing secrets", () => {
  assert.match(workflow, /Verify protected signing boundary for exact-head Android release candidate/);
  assert.match(workflow, /Mobile Native must not produce a release APK without the dedicated protected signing material/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_SIGNING_REQUIRED/);
  assert.match(workflow, /signed stable APK owner: \\`Android Stable Release\\`/);
  assert.doesNotMatch(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEYSTORE_B64/);
  assert.doesNotMatch(workflow, /secrets\.NUSA_ANDROID_RELEASE_STORE_PASSWORD/);
  assert.doesNotMatch(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_ALIAS/);
  assert.doesNotMatch(workflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_PASSWORD/);
  assert.doesNotMatch(workflow, /secrets\.NUSA_ANDROID_RELEASE_CERT_SHA256/);
});

test("Android Stable Release remains the sole protected-signing secret owner", () => {
  assert.match(stableWorkflow, /secrets\.NUSA_ANDROID_RELEASE_KEYSTORE_B64/);
  assert.match(stableWorkflow, /secrets\.NUSA_ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(stableWorkflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(stableWorkflow, /secrets\.NUSA_ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(stableWorkflow, /secrets\.NUSA_ANDROID_RELEASE_CERT_SHA256/);
  assert.match(stableWorkflow, /Validate protected signing configuration before build/);
});

test("release packaging still fails closed without protected signing and never falls back to debug signing", () => {
  assert.match(gradle, /NUSA_ANDROID_RELEASE_SIGNING_REQUIRED/);
  assert.match(gradle, /nusaReleaseTaskRequested && !nusaReleaseSigningReady/);
  assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
  assert.doesNotMatch(workflow, /NUSA_ANDROID_RELEASE_KEYSTORE_B64:\s*[^$]/);
});
