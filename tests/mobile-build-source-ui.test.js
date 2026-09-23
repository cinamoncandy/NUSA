import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const homeView = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const settingsView = fs.readFileSync("apps/mobile/src/settingsView.tsx", "utf8");
const notice = fs.readFileSync("apps/mobile/src/buildSourceNotice.tsx", "utf8");
const generatedConfig = fs.readFileSync("apps/mobile/src/generatedBuildConfig.ts", "utf8");

test("packaged build identity and stale-release detection are on a surface the owner can reach", () => {
  assert.match(generatedConfig, /export const BUILD_SOURCE_SHA/);
  assert.match(notice, /BUILD_SOURCE_SHA/);
  assert.match(notice, /BUILD_SOURCE_SHA\.slice\(0, 8\)/);
  assert.match(notice, /testID="mobile-build-source"/);
  assert.match(notice, /빌드 \{buildLabel\}/);
  assert.match(notice, /releases\/tags\/nusa-android/);
  assert.match(notice, /target_commitish/);
  assert.match(notice, /업데이트 필요/);
  assert.match(notice, /releases\/download\/nusa-android\/NUSA-Android\.apk/);
  assert.match(notice, /testID="mobile-update-action"/);

  // Reachability is the point. This lived in moreView.tsx, which App.tsx never rendered, while HOME
  // carried a duplicate inside style={{position:"absolute",opacity:0}} — so the owner could not see
  // which build was installed on a device, during an acceptance loop that depends on exactly that.
  // Settings is reachable from the tools tray, so assert the whole chain, not just the file.
  assert.match(settingsView, /import \{ BuildSourceNotice \} from "\.\/buildSourceNotice"/);
  assert.match(settingsView, /<BuildSourceNotice \/>/);
  assert.match(app, /utilityView === "SETTINGS" \? <SettingsView/);
  assert.match(app, /"header-settings"/);
  assert.doesNotMatch(homeView, /position:"absolute",opacity:0/);
});

test("the build notice claims nothing it has not verified and gains no authority", () => {
  // Fails closed: a failed lookup, a non-200, or a target that is not 40 hex stays UNKNOWN and
  // reports neither 최신 nor 업데이트 필요.
  assert.match(notice, /\.catch\(\(\) => \{ if \(active\) setFreshness\("UNKNOWN"\); \}\)/);
  assert.match(notice, /if \(!response\.ok\) throw new Error/);
  assert.match(notice, /if \(!\/\^\[0-9a-f\]\{40\}\$\/i\.test\(target\)\) throw new Error/);
  assert.match(notice, /useState<BuildFreshness>\("UNKNOWN"\)/);
  assert.doesNotMatch(notice, /placeOrder|cancelOrder|withdraw|transfer|LIVE/i);
  assert.doesNotMatch(notice, /secret|accessKey|token|Authorization/i);
});
