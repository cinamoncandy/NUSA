const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function rgbSpread(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  return Math.max(...channels) - Math.min(...channels);
}

test("mobile v1 keeps brand actions monochrome across design presets and reserves chromatic colors for AI signals", () => {
  const source = read("apps/mobile/src/designSystem.ts");

  // Every shipped preset owns one dark and one light primary action color. Keep
  // those action colors near-neutral so redesigns can evolve without coupling
  // this policy test to a specific hex literal.
  const presetPrimaries = [...source.matchAll(/primary: "(#[0-9A-F]{6})"/g)].map((match) => match[1]);
  assert.equal(presetPrimaries.length, 4);
  for (const primary of presetPrimaries) {
    assert.ok(rgbSpread(primary) <= 28, `brand primary must remain near-neutral: ${primary}`);
  }
  assert.match(source, /primary: palette\.primary/);

  // Chromatic accents remain explicitly named signal tokens rather than becoming
  // the generic primary action color.
  assert.match(source, /aiSignalStart: "#[0-9A-F]{6}"/);
  assert.match(source, /aiSignalMid: "#[0-9A-F]{6}"/);
  assert.match(source, /aiSignalEnd: "#[0-9A-F]{6}"/);
  assert.match(source, /aiSignalSoft/);
  assert.doesNotMatch(source, /primary: "#(?:9B6CFF|5B8CFF|36D8CB)"/);
});

test("APEX mobile and Android assets remain monochrome", () => {
  const components = read("apps/mobile/src/components.tsx");
  assert.match(components, /borderBottomColor: theme\.colors\.text/);
  assert.match(components, /backgroundColor: theme\.colors\.text/);
  for (const file of [
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo_foreground.xml",
    "apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher.xml",
    "apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher_round.xml",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /#6D8DFF|#87A0F7/);
    assert.match(source, /#FFFFFFFF/);
  }
});
