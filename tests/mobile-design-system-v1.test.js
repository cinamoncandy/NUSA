const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile presets keep classic neutral while approved wealth-product colors are centralized", () => {
  const source = read("apps/mobile/src/designSystem.ts");

  assert.match(source, /classic:[\s\S]*?primary: "#E8F3FF"[\s\S]*?primary: "#11151B"/);
  assert.match(source, /export const wealthProductColors = Object\.freeze/);
  assert.match(source, /master:[\s\S]*?primary: "#BFE85A"[\s\S]*?primary: "#304EE8"/);
  assert.match(source, /primary: palette\.primary/);

  // Signal semantics use the approved wealth terrain in dark mode while light mode remains accessible.
  assert.match(source, /aiSignalStart: dark \? "#91C74F" : "#7C3AED"/);
  assert.match(source, /aiSignalMid: dark \? "#B7E35C" : "#2563EB"/);
  assert.match(source, /aiSignalEnd: dark \? "#BFE85A" : "#0B6B60"/);
  assert.match(source, /aiSignalSoft/);
});

test("runtime brand placeholder stays suppressed while signal color remains semantic", () => {
  const components = read("apps/mobile/src/components.tsx");
  const terrainStart = components.indexOf("export function TerrainSignal");
  const waveMarkStart = components.indexOf("export function WaveMark");
  assert.ok(terrainStart >= 0 && waveMarkStart > terrainStart, "TerrainSignal and WaveMark boundaries must remain explicit");

  const terrain = components.slice(terrainStart, waveMarkStart);
  assert.match(terrain, /theme\.colors\.aiSignalStart/);
  assert.match(terrain, /theme\.colors\.aiSignalMid/);
  assert.match(terrain, /theme\.colors\.aiSignalEnd/);

  // The provisional runtime mark is intentionally not product-facing while logo production is HOLD.
  const waveMark = components.slice(waveMarkStart, components.indexOf("export function SectionHeading", waveMarkStart));
  assert.match(waveMark, /return null;/);
  assert.doesNotMatch(waveMark, /aiSignalStart|aiSignalMid|aiSignalEnd|neonBlue/);
});

test("Android NUSA launcher and splash assets use the approved wealth identity", () => {
  for (const file of [
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo_foreground.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher_round.xml",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /#6D8DFF|#87A0F7|#9B6CFF|#5B8CFF|#36D8CB/);
    assert.match(source, /#BFE85A|#FFBFE85A|#FFFFFFFF/);
  }
});
