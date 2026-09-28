const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("runtime mobile brand keeps the provisional symbol hidden while logo production is on hold", () => {
  const components = read("apps/mobile/src/components.tsx");
  const app = read("apps/mobile/App.tsx");

  assert.match(components, /export function WaveMark\(_props:[\s\S]*?return null;/);
  assert.doesNotMatch(components, /symbolPeak|symbolReflection|symbolReflectionLine/);
  assert.match(app, />NUSA<\/Text>/);
});

test("Android launcher resources expose Concept 1, monochrome, notification, and splash assets", () => {
  const manifest = read("apps/mobile/android/app/src/main/AndroidManifest.xml");
  const fallback = read("apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher.xml");
  const fallbackRound = read("apps/mobile/android/app/src/main/res/mipmap-anydpi-v24/ic_launcher_round.xml");
  const adaptive = read("apps/mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");
  const logo = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml");
  const notification = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_notification.xml");
  const splash = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml");
  const api31Theme = read("apps/mobile/android/app/src/main/res/values-v31/styles.xml");

  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  // Intelligence Field mark: amber diamond core inside an orbit of five subsystem arcs.
  for (const drawable of [fallback, fallbackRound, logo, splash]) {
    assert.match(drawable, /orbit of five subsystem arcs/);
    assert.match(drawable, /NUSA Intelligence Field mark/);
    assert.match(drawable, /#FFB547/);
    for (const hue of ["#4FC3F7", "#9B7BFF", "#3DDC97", "#7C8CFF", "#FFA94D"]) assert.ok(drawable.includes(hue), hue);
  }
  assert.match(fallback, /#010204/);
  assert.match(adaptive, /<monochrome android:drawable="@drawable\/ic_nusa_logo_monochrome"\s*\/>/);
  assert.match(notification, /NUSA Intelligence Field mark/);
  assert.doesNotMatch(notification, /#(?!FFFFFFFF|00000000)[0-9A-F]{6}/i, "notification icon must stay monochrome");
  assert.match(api31Theme, /windowSplashScreenAnimatedIcon/);
});
