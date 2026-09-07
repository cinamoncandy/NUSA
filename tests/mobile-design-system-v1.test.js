const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile presets keep classic neutral and apply approved cobalt master actions", () => {
  const source = read("apps/mobile/src/designSystem.ts");

  // Master actions use the approved cobalt palette; semantic AI and risk colors remain separate.
  assert.match(source, /classic:[\s\S]*?primary: "#E8F3FF"[\s\S]*?primary: "#11151B"/);
  assert.match(source, /master:[\s\S]*?primary: "#9BABFF"[\s\S]*?primary: "#304EE8"/);
  assert.match(source, /primary: palette\.primary/);

  // Chromatic accents remain confined to signal/AI semantics rather than brand actions. Each
  // resolves per mode -- the dark-tuned hues fall to as little as ~1.5:1 contrast on a light
  // surface, so a light-mode variant exists for each rather than one value used unconditionally.
  assert.match(source, /aiSignalStart: dark \? "#9B6CFF" : "#[0-9A-F]{6}"/);
  assert.match(source, /aiSignalMid: dark \? "#5B8CFF" : "#[0-9A-F]{6}"/);
  assert.match(source, /aiSignalEnd: dark \? "#36D8CB" : "#[0-9A-F]{6}"/);
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

test("Android APEX launcher and splash assets remain monochrome", () => {
  for (const file of [
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo_foreground.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher_round.xml",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /#6D8DFF|#87A0F7|#9B6CFF|#5B8CFF|#36D8CB/);
    assert.match(source, /#FFFFFFFF/);
  }
});
