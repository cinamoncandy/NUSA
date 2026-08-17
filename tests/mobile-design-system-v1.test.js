const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile v1 keeps brand actions monochrome across design presets and reserves chromatic colors for AI signals", () => {
  const source = read("apps/mobile/src/designSystem.ts");

  // Design presets may change the visual system without weakening the brand-action
  // contract: primary actions remain monochrome in every shipped preset.
  assert.match(source, /classic: Object\.freeze\([\s\S]*?primary: "#E8F3FF"[\s\S]*?primary: "#11151B"/);
  assert.match(source, /master: Object\.freeze\([\s\S]*?primary: "#FFFFFF"[\s\S]*?primary: "#11131A"/);
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
