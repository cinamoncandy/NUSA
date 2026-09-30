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
  // Owner-chosen N monogram (2026-09-28), recolored lime to match the theme (2026-09-30): lime N on deep navy.
  for (const drawable of [fallback, fallbackRound, logo, splash]) {
    assert.match(drawable, /NUSA N monogram mark/);
    assert.match(drawable, /#B6F04B/);
  }
  for (const drawable of [fallback, fallbackRound]) assert.match(drawable, /#121B30/);
  assert.match(adaptive, /<monochrome android:drawable="@drawable\/ic_nusa_logo_monochrome"\s*\/>/);
  assert.match(notification, /NUSA N monogram mark/);
  assert.doesNotMatch(notification, /#(?!FFFFFFFF|00000000)[0-9A-F]{6}/i, "notification icon must stay monochrome");
  assert.match(api31Theme, /windowSplashScreenAnimatedIcon/);
});
