const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const androidMain = path.join(root, "apps/mobile/android/app/src/main");
const nativeDir = path.join(androidMain, "java/com/nusa/mobile");

const read = (p) => fs.readFileSync(p, "utf8");

test("Android self updater is foreground-triggered and OS installer mediated", () => {
  const activity = read(path.join(nativeDir, "MainActivity.kt"));
  const updater = read(path.join(nativeDir, "NusaSelfUpdater.kt"));
  assert.match(activity, /override fun onResume\(\)/);
  assert.match(activity, /NusaSelfUpdater\.checkFrom\(this\)/);
  assert.match(updater, /Intent\.ACTION_VIEW/);
  assert.match(updater, /application\/vnd\.android\.package-archive/);
  assert.match(updater, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.doesNotMatch(updater, /pm\s+install|su\s|Runtime\.getRuntime\(\)\.exec/);
});

test("Android self updater accepts only canonical stable assets and verifies SHA-256", () => {
  const updater = read(path.join(nativeDir, "NusaSelfUpdater.kt"));
  assert.match(updater, /releases\/tags\/nusa-android/);
  assert.match(updater, /releases\/download\/nusa-android\/NUSA-Android\.apk/);
  assert.match(updater, /NUSA-Android\.apk\.sha256/);
  assert.match(updater, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(updater, /if \(sha256\(apk\) != expectedSha\)/);
  assert.match(updater, /require\(connection\.url\.protocol == "https"\)/);
  assert.match(updater, /MAX_APK_BYTES/);
});

test("Android manifest exposes only cache-scoped update APK through a non-exported FileProvider", () => {
  const manifest = read(path.join(androidMain, "AndroidManifest.xml"));
  const paths = read(path.join(androidMain, "res/xml/nusa_update_paths.xml"));
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="androidx\.core\.content\.FileProvider"/);
  assert.match(manifest, /android:exported="false"/);
  assert.match(manifest, /android:grantUriPermissions="true"/);
  assert.match(paths, /<cache-path name="nusa_updates" path="updates\/" \/>/);
  assert.doesNotMatch(paths, /external-path|root-path/);
});
