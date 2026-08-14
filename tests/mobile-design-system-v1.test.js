const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile v5 uses a single cold-mint brand accent and reserves the wider gradient for AI signals", () => {
  const source = read("apps/mobile/src/designSystem.ts");
  assert.match(source, /primary: dark \? "#7FE8C6" : "#0C7A56"/);
  assert.match(source, /aiSignalStart: "#A855F7"/);
  assert.match(source, /aiSignalMid: "#4F7CFF"/);
  assert.match(source, /aiSignalEnd: "#2DD4BF"/);
  assert.match(source, /aiSignalSoft/);
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
