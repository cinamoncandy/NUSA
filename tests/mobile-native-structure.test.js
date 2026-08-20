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
  assert.equal(fs.existsSync(path.join(mobile, "metro.config.js")), true);
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

test("Android release networking fails closed without an unresolved manifest placeholder", () => {
  const manifest = fs.readFileSync(path.join(mobile, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  const gradle = fs.readFileSync(path.join(mobile, "android", "app", "build.gradle"), "utf8");
  assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
  assert.match(gradle, /manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/);
  assert.equal((gradle.match(/manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/g) ?? []).length, 2);
});

test("mobile foundation exposes a Home screen, theme, and four primary decision-flow tabs", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  assert.match(app, /useState<Tab>\("Home"\)/);
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\]/);
  assert.match(app, /type Tab = PrimaryTab \| "AiSignal" \| "Order"/);
  assert.match(app, /Home: "HOME", Markets: "MARKET", Paper: "TRADE", Portfolio: "PORTFOLIO"/);
  assert.match(app, /const theme =/);
  assert.match(app, /accessibilityRole="button"/);
});

test("fresh-install entry is explicitly local and does not impersonate account authentication", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /계정 인증이 아닙니다/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.doesNotMatch(app, /accessibilityLabel="Email"|accessibilityLabel="Password"|testID="auth-email"|testID="auth-password"/);
});

test("local entry guard still exposes Splash and Auth Context without claiming identity verification", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  const context = fs.readFileSync(path.join(mobile, "src", "authContext.ts"), "utf8");
  assert.match(app, /authStatus === "CHECKING"/);
  assert.match(app, /AuthContextProvider/);
  assert.match(app, /authStatus !== "SIGNED_IN"/);
  assert.match(context, /AuthContext/);
  assert.match(app, /사용자 신원을 검증하지 않으며/);
});

test("mobile release workflow validates unsigned Android and iOS candidates", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/mobile-native.yml"), "utf8");
  assert.match(workflow, /android-release-candidate:/);
  assert.match(workflow, /:app:assembleRelease/);
  assert.match(workflow, /ios-release-candidate:/);
  assert.match(workflow, /-configuration Release/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
});

test("mobile workflow cancels obsolete runs and reuses safe dependency caches", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/mobile-native.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(workflow.includes("group: mobile-native-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"), true);
  assert.equal(workflow.includes("cancel-in-progress: true"), true);
  assert.equal((workflow.match(/cache: pnpm/g) ?? []).length, 5);
  assert.equal((workflow.match(/cache: gradle/g) ?? []).length, 2);
  assert.equal(workflow.includes("if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'release-candidate')"), true);
});