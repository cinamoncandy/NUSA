const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const stable = fs.readFileSync(".github/workflows/android-stable-release.yml", "utf8");
const trigger = fs.readFileSync(".github/workflows/android-stable-release-trigger.yml", "utf8");
const watchdog = fs.readFileSync(".github/workflows/android-stable-release-watchdog.yml", "utf8");
const guard = fs.readFileSync(".github/workflows/android-release-pipeline-guard.yml", "utf8");
const gradle = fs.readFileSync("apps/mobile/android/app/build.gradle", "utf8");

function assertFailClosedSafety(text) {
  assert.match(text, /main/i);
  assert.match(text, /Android Stable Release|android-stable-release/);
}

test("stable release keeps exact-main, protected signing, signature and artifact integrity gates", () => {
  assert.match(stable, /Refusing stale manual Android release source/);
  assert.match(stable, /Android release signing readiness/);
  assert.match(stable, /NUSA_ANDROID_RELEASE_KEYSTORE_B64/);
  assert.match(stable, /certificate-mismatch/);
  assert.match(stable, /apksigner/);
  assert.match(stable, /Verify stable GitHub asset download integrity/);
  assert.match(stable, /Firebase distribution failed after 3 attempts/);
});

test("release trigger is exact-main, idempotent and bounded", () => {
  assertFailClosedSafety(trigger);
  assert.match(trigger, /status=completed/);
  assert.match(trigger, /CI_CONCLUSION/);
  assert.match(trigger, /ACTIVE_ID/);
  assert.match(trigger, /Main changed before dispatch/);
  assert.match(trigger, /inputs\[source_sha\]=\$MAIN_SHA/);
  assert.match(trigger, /seq 1 60/);
});

test("watchdog self-heals only within a bounded retry budget", () => {
  assertFailClosedSafety(watchdog);
  assert.match(watchdog, /run_attempt/);
  assert.match(watchdog, /FAILED_ATTEMPT.*-lt 3/s);
  assert.match(watchdog, /rerun-failed-jobs/);
  assert.match(watchdog, /Automatic retry budget exhausted/);
  assert.match(watchdog, /productionMutationAllowed=false/);
  assert.match(watchdog, /AI=ZERO_AUTHORITY/);
});

test("release pipeline guard configures Gradle with an ephemeral non-production signing key", () => {
  assert.match(guard, /Generate ephemeral CI-only signing key/);
  assert.match(guard, /Validate Android release Gradle DSL with signing enabled/);
  assert.match(guard, /\.\/gradlew :app:tasks --all --no-daemon --stacktrace/);
  assert.match(guard, /! grep -Eq 'enableV3Signing\|enableV4Signing'/);
  assert.match(guard, /! test -f apps\/mobile\/android\/app\/debug\.keystore/);
});

test("Android release signing DSL stays compatible and never falls back to debug signing", () => {
  assert.match(gradle, /enableV1Signing true/);
  assert.match(gradle, /enableV2Signing true/);
  assert.doesNotMatch(gradle, /enableV3Signing|enableV4Signing/);
  assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
  assert.match(gradle, /NUSA_ANDROID_RELEASE_SIGNING_REQUIRED/);
});
