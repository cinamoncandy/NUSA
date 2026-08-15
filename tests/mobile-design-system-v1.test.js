const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile v1 keeps brand actions monochrome and reserves chromatic colors for AI signals", () => {
  const source = read("apps/mobile/src/designSystem.ts");
  assert.match(source, /primary: dark \? "#E8F3FF" : "#11151B"/);
  assert.match(source, /aiSignalStart: "#B56BFF"/);
  assert.match(source, /aiSignalMid: "#5B8CFF"/);
  assert.match(source, /aiSignalEnd: "#49D7C3"/);
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
