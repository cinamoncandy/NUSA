const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the field preset is the only design system and keeps signal colour semantic", () => {
  const source = read("apps/mobile/src/designSystem.ts");
  assert.match(source, /export type DesignPresetName = "field";/);
  assert.doesNotMatch(source, /classic:|master:/);
  assert.match(source, /primary: palette\.primary/);
  assert.match(source, /aiSignalStart: fieldPalette\.axiom/);
  assert.match(source, /aiSignalMid: fieldPalette\.market/);
  assert.match(source, /aiSignalEnd: fieldPalette\.label/);
});

test("runtime brand placeholder stays suppressed and legacy motion components are removed", () => {
  const components = read("apps/mobile/src/components.tsx");
  assert.doesNotMatch(components, /export function (TerrainSignal|IntelligenceMotionField)/);
  const waveMarkStart = components.indexOf("export function WaveMark");
  assert.ok(waveMarkStart >= 0);
  const waveMark = components.slice(waveMarkStart, components.indexOf("export function SectionHeading", waveMarkStart));
  assert.match(waveMark, /return null;/);
});

test("Android launcher uses the field mark while themed and notification icons stay monochrome", () => {
  for (const file of [
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo_foreground.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher_round.xml",
  ]) {
    const source = read(file);
    // Retired legacy brand hues must not return.
    assert.doesNotMatch(source, /#6D8DFF|#87A0F7|#9B6CFF|#5B8CFF|#36D8CB/);
    assert.match(source, /#FFB547/);
  }
  for (const file of [
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo_monochrome.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_notification.xml",
  ]) {
    const source = read(file);
    assert.match(source, /#FFFFFFFF/);
    assert.doesNotMatch(source, /#(?!FFFFFFFF|00000000)[0-9A-F]{6,8}"/i);
  }
});
