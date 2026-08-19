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
  const adaptive = read("apps/mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");
  const logo = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_logo.xml");
  const notification = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_notification.xml");
  const splash = read("apps/mobile/android/app/src/main/res/drawable/ic_nusa_splash.xml");
  const api31Theme = read("apps/mobile/android/app/src/main/res/values-v31/styles.xml");

  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(fallback, /M54,24L82,62H26Z/);
  assert.match(logo, /M54,24L82,62H26Z/);
  assert.match(splash, /M54,22L84,64H24Z/);
  assert.match(adaptive, /<monochrome android:drawable="@drawable\/ic_nusa_logo_monochrome"\s*\/>/);
  assert.match(notification, /M12,3L20,14H4Z/);
  assert.match(api31Theme, /windowSplashScreenAnimatedIcon/);
});
