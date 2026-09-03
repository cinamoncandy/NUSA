const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile UI delivery has explicit source, main, stable, and device truth states", () => {
  const contract = read("docs/NUSA_MOBILE_UI_DELIVERY_CONTRACT.md");
  const aipos = read(".aipos/aipos.yaml");

  for (const state of ["SOURCE_ONLY", "MAIN_INTEGRATED", "STABLE_RELEASED", "DEVICE_VERIFIED"]) {
    assert.match(contract, new RegExp(`\\b${state}\\b`));
  }
  assert.match(contract, /must not be described as applied, deployed, shipped, installed, or visible on the owner's phone/);
  assert.match(contract, /DEVICE_NOT_VERIFIED/);
  assert.match(aipos, /mobile_ui_delivery_contract:\s*docs\/NUSA_MOBILE_UI_DELIVERY_CONTRACT\.md/);
  assert.match(aipos, /before claiming a mobile UI change is applied, deployed, shipped, installed, or complete/);
});

test("a newly packaged release invalidates stale internal visual preset state", () => {
  const provider = read("apps/mobile/src/ThemeProvider.tsx");

  assert.match(provider, /import \{ BUILD_SOURCE_SHA \} from "\.\/generatedBuildConfig"/);
  assert.match(provider, /RELEASE_BUILD_SOURCE_SHA = \/\^\[0-9a-f\]\{40\}\$\/i\.test\(BUILD_SOURCE_SHA\)/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_VERSION = RELEASE_BUILD_SOURCE_SHA == null \? "dev-v3" : `build:\$\{RELEASE_BUILD_SOURCE_SHA\}`/);
  assert.match(provider, /storedSchema !== DESIGN_PRESET_SCHEMA_VERSION/);
  assert.match(provider, /setPresetState\(CURRENT_DEFAULT_PRESET\)/);
  assert.match(provider, /AsyncStorage\.setItem\(DESIGN_PRESET_STORAGE_KEY, CURRENT_DEFAULT_PRESET\)/);
  assert.doesNotMatch(provider, /DESIGN_PRESET_SCHEMA_VERSION\s*=\s*"2"/);
});

test("installed app exposes both build identity and active UI preset", () => {
  const more = read("apps/mobile/src/moreView.tsx");

  assert.match(more, /const \{ theme, preset \} = useTheme\(\)/);
  assert.match(more, /testID="mobile-build-source"/);
  assert.match(more, /빌드 \{buildLabel\} · UI \{preset\.toUpperCase\(\)\}/);
  assert.match(more, /업데이트 필요/);
  assert.match(more, /testID="mobile-update-action"/);
});

test("Android stable delivery remains exact-main and provenance bound", () => {
  const watchdog = read(".github/workflows/android-stable-release-watchdog.yml");
  const release = read(".github/workflows/android-stable-release.yml");

  assert.match(watchdog, /if \[ "\$RELEASE_TARGET" = "\$MAIN_SHA" \]/);
  assert.match(watchdog, /exact-main convergence is required/);
  assert.doesNotMatch(watchdog, /git diff --quiet/);
  assert.match(release, /Verify source is still current main before build/);
  assert.match(release, /CURRENT_MAIN=.*branches\/main/);
  assert.match(release, /source_sha=%s/);
  assert.match(release, /targetCommitish/);
});
