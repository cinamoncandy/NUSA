import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const agents = fs.readFileSync("AGENTS.md", "utf8");
const moreView = fs.readFileSync("apps/mobile/src/moreView.tsx", "utf8");
const watchdog = fs.readFileSync(".github/workflows/android-stable-release-watchdog.yml", "utf8");
const release = fs.readFileSync(".github/workflows/android-stable-release.yml", "utf8");

test("mobile UI delivery claims are governed by an explicit repository-wide truth contract", () => {
  assert.match(agents, /## Mobile UI delivery truth/);
  assert.match(agents, /BRANCH_IMPLEMENTED/);
  assert.match(agents, /MAIN_MERGED/);
  assert.match(agents, /STABLE_RELEASED/);
  assert.match(agents, /DEVICE_VERIFIED/);
  assert.match(agents, /Never describe BRANCH_IMPLEMENTED or MAIN_MERGED work as installed, deployed, visible on device, or applied to the owner\x27s phone/i);
});

test("installed Android builds expose their exact packaged source and stale-install warning", () => {
  assert.match(moreView, /BUILD_SOURCE_SHA/);
  assert.match(moreView, /testID="mobile-build-source"/);
  assert.match(moreView, /업데이트 필요/);
  assert.match(moreView, /testID="mobile-update-action"/);
});

test("Android stable watchdog requires exact protected-main convergence without a path-diff bypass", () => {
  assert.match(watchdog, /RELEASE_TARGET/);
  assert.match(watchdog, /MAIN_SHA/);
  assert.match(watchdog, /exact-main convergence is required/);
  assert.doesNotMatch(watchdog, /git diff --quiet/);
  assert.doesNotMatch(watchdog, /No Android release-relevant drift/);
});

test("stable APK has monotonic build identity and is checked against exact current main", () => {
  assert.match(release, /NUSA_BUILD_NUMBER: \$\{\{ steps\.release\.outputs\.version \}\}/);
  assert.match(release, /versionCode='\$\{EXPECTED_VERSION\}'/);
  assert.match(release, /Refusing to build stale Android release source/);
  assert.match(release, /Refusing stale Android stable finalization/);
  assert.match(release, /--target "\$TARGET_SHA"/);
});
