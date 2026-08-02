const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

test("mobile repository exposes the React Native foundation and native project paths", () => {
  assert.equal(fs.existsSync(path.join(mobile, "App.tsx")), true);
  assert.equal(fs.existsSync(path.join(mobile, "index.js")), true);
  assert.equal(fs.existsSync(path.join(mobile, "app.json")), true);
  assert.equal(fs.existsSync(path.join(mobile, "package.json")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "settings.gradle")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "build.gradle")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "gradlew")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "app", "build.gradle")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "app", "src", "main", "AndroidManifest.xml")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "app", "src", "main", "java", "com", "nusa", "mobile", "MainActivity.kt")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android", "app", "src", "main", "java", "com", "nusa", "mobile", "MainApplication.kt")), true);
  assert.equal(fs.existsSync(path.join(mobile, "ios", "Podfile")), true);
  assert.equal(fs.existsSync(path.join(mobile, "ios", "NusaMobile.xcodeproj", "project.pbxproj")), true);
  assert.equal(fs.existsSync(path.join(mobile, "ios", "NusaMobile", "AppDelegate.swift")), true);
  assert.equal(fs.existsSync(path.join(mobile, "ios", "NusaMobile", "Info.plist")), true);
});

test("native bootstrap pins the approved React Native and platform configuration", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
  assert.equal(manifest.nativeProjectStatus, "RN_0.86.0_BOOTSTRAPPED");
  assert.equal(manifest.dependencies["react-native"], "0.86.0");
  assert.equal(manifest.packageManager, "pnpm@11.7.0");
  assert.match(fs.readFileSync(path.join(mobile, "android", "gradle.properties"), "utf8"), /newArchEnabled=true/);
  assert.match(fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8"), /minSdkVersion = 24/);
  assert.match(fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8"), /targetSdkVersion = 35/);
  assert.match(fs.readFileSync(path.join(mobile, "ios", "NusaMobile.xcodeproj", "project.pbxproj"), "utf8"), /IPHONEOS_DEPLOYMENT_TARGET = 15\.0/);
});
