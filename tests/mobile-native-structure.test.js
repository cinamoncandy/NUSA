const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mobile = path.join(root, "apps", "mobile");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("mobile repository exposes the React Native foundation and native project paths", () => {
  assert.ok(fs.existsSync(path.join(mobile, "App.tsx")));
  assert.ok(fs.existsSync(path.join(mobile, "package.json")));
  assert.ok(fs.existsSync(path.join(mobile, "android", "app", "src", "main", "AndroidManifest.xml")));
  assert.ok(fs.existsSync(path.join(mobile, "ios", "NusaMobile", "Info.plist")));
});

test("native bootstrap pins the approved React Native and Android platform configuration", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
  const gradle = fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8");
  assert.equal(pkg.dependencies["react-native"], "0.77.3");
  assert.match(gradle, /compileSdkVersion\s*=\s*35/);
  assert.match(gradle, /targetSdkVersion\s*=\s*35/);
});

test("React Native upgrades keep the Gradle wrapper compatible with the Android plugin", () => {
  const wrapper = read("apps/mobile/android/gradle/wrapper/gradle-wrapper.properties");
  const settings = read("apps/mobile/android/settings.gradle");
  assert.match(wrapper, /gradle-8\.10\.2-bin\.zip/);
  assert.match(settings, /com\.facebook\.react\.settings/);
});

test("pull-request workflows cannot self-mutate and push their own branch", () => {
  const workflow = read(".github/workflows/mobile-native.yml");
  assert.doesNotMatch(workflow, /permissions:\s*[\s\S]*?contents:\s*write/);
  assert.doesNotMatch(workflow, /git push/);
});

test("Android release networking fails closed without an unresolved manifest placeholder", () => {
  const manifest = read("apps/mobile/android/app/src/main/AndroidManifest.xml");
  const gradle = read("apps/mobile/android/app/build.gradle");
  assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
  assert.match(gradle, /manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/);
  assert.equal((gradle.match(/manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/g) ?? []).length, 2);
  assert.match(gradle, /nusaCanonicalOrigin/);
  assert.match(gradle, /nusa_canonical_origin/);
});

test("mobile foundation exposes a Home screen, theme, and four primary decision-flow tabs", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  assert.match(app, /useState<Tab>\("Home"\)/);
  assert.match(app, /const tabs = \["Home", "Markets", "Paper", "Portfolio"\]/);
  assert.match(app, /type Tab = PrimaryTab \| "AiSignal" \| "Order"/);
  assert.match(app, /Home: "HOME", Markets: "MARKETS", Paper: "PAPER", Portfolio: "PORTFOLIO"/);
  assert.match(app, /const theme =/);
  assert.match(app, /accessibilityRole="button"/);
});

test("fresh-install entry is explicitly local and does not impersonate account authentication", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /계정 인증이 아닙니다/);
});

test("local entry guard still exposes Splash and Auth Context without claiming identity verification", () => {
  const app = fs.readFileSync(path.join(mobile, "App.tsx"), "utf8");
  assert.match(app, /AuthContextProvider/);
  assert.match(app, /CHECKING/);
  assert.doesNotMatch(app, /비밀번호를 저장/);
});

test("mobile release workflow validates Android candidates and explicitly skips iOS delivery", () => {
  const workflow = read(".github/workflows/mobile-native.yml");
  assert.match(workflow, /android-debug:/);
  assert.match(workflow, /android-release-candidate:/);
  assert.match(workflow, /ios-debug:\s*\n\s*if:\s*\$\{\{ false \}\}/);
  assert.match(workflow, /ios-release-candidate:\s*\n\s*if:\s*\$\{\{ false \}\}/);
});

test("Android networking layer replaces (not appends) the User-Agent so Upbit's public API stops rejecting requests with HTTP 400", () => {
  const source = read("apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaNetworkInterceptor.kt");
  assert.match(source, /header\("User-Agent"/);
  assert.doesNotMatch(source, /addHeader\("User-Agent"/);
});

test("native network diagnostics capture only URL/method/User-Agent, read-only, without touching the response", () => {
  const source = read("apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaNetworkInterceptor.kt");
  assert.match(source, /request\.url/);
  assert.match(source, /request\.method/);
  assert.match(source, /User-Agent/);
  assert.doesNotMatch(source, /response\.body/);
});

test("Android mobile workflow cancels obsolete runs and reuses safe dependency caches", () => {
  const workflow = read(".github/workflows/mobile-native.yml");
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /cache:\s*pnpm/);
  assert.match(workflow, /cache:\s*gradle/);
});
