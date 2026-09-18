import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeView = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const moreView = fs.readFileSync("apps/mobile/src/moreView.tsx", "utf8");
const generatedConfig = fs.readFileSync("apps/mobile/src/generatedBuildConfig.ts", "utf8");

test("production HOME keeps build provenance generated while consumer HOME stays free of developer build metadata", () => {
  assert.match(generatedConfig, /export const BUILD_SOURCE_SHA/);
  assert.doesNotMatch(homeView, /BUILD_SOURCE_SHA|home-build-source|packagedBuildLabel|UI INTELLIGENCE OS/);
  assert.match(homeView, /AI FOR A WEALTHIER YOU/);
  assert.match(homeView, /PAPER MODE/);
});

test("legacy More surface retains exact packaged build source identity and stale release detection", () => {
  assert.match(moreView, /BUILD_SOURCE_SHA/);
  assert.match(moreView, /testID="mobile-build-source"/);
  assert.match(moreView, /빌드 \{buildLabel\}/);
  assert.match(moreView, /BUILD_SOURCE_SHA\.slice\(0, 8\)/);
  assert.match(moreView, /releases\/tags\/nusa-android/);
  assert.match(moreView, /target_commitish/);
  assert.match(moreView, /업데이트 필요/);
  assert.match(moreView, /releases\/download\/nusa-android\/NUSA-Android\.apk/);
});
