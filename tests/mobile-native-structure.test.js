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
});

test("native bootstrap pins the approved React Native and Android platform configuration", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
  const gradleProperties = fs.readFileSync(path.join(mobile, "android", "gradle.properties"), "utf8");
  const buildGradle = fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8");

  assert.equal(manifest.nativeProjectStatus, "RN_0.87.0_BOOTSTRAPPED");
  assert.equal(manifest.dependencies["react-native"], "0.87.0");
  assert.equal(manifest.packageManager, "pnpm@11.7.0");
  assert.match(gradleProperties, /newArchEnabled=true/);
  assert.match(gradleProperties, /hermesEnabled=true/);
  assert.match(gradleProperties, /android\.builtInKotlin=false/);
  assert.match(gradleProperties, /android\.newDsl=false/);
  assert.match(buildGradle, /buildToolsVersion = "37\.0\.0"/);
  assert.match(buildGradle, /minSdkVersion = 24/);
  assert.match(buildGradle, /compileSdkVersion = 37/);
  assert.match(buildGradle, /targetSdkVersion = 36/);
  assert.match(buildGradle, /kotlinVersion = "2\.2\.0"/);
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

test("mobile release workflow validates Android candidates and explicitly skips iOS delivery", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/mobile-native.yml"), "utf8");
  assert.match(workflow, /android-debug:/);
  assert.match(workflow, /:app:assembleDebug -PnusaEmbedDebugBundle/);
  assert.match(workflow, /android-release-candidate:/);
  assert.match(workflow, /:app:assembleRelease/);
  assert.match(workflow, /sdkmanager "platforms;android-37" "build-tools;37\.0\.0"/);
  assert.match(workflow, /ios-debug:\s*\r?\n\s*if: \$\{\{ false \}\}/);
  assert.match(workflow, /ios-release-candidate:\s*\r?\n\s*if: \$\{\{ false \}\}/);
  assert.match(workflow, /Android-only/);
  assert.doesNotMatch(workflow, /xcodebuild/);
});

test("Android mobile workflow cancels obsolete runs and reuses safe dependency caches", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/mobile-native.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(workflow.includes("group: mobile-native-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"), true);
  assert.equal(workflow.includes("cancel-in-progress: true"), true);
  assert.equal((workflow.match(/cache: pnpm/g) ?? []).length, 3);
  assert.equal((workflow.match(/cache: gradle/g) ?? []).length, 2);
  assert.equal(workflow.includes("if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'release-candidate')"), true);
});