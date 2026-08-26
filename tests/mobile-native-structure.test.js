const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");
const repoRoot = path.resolve(__dirname, "..");

const parseVersion = (value) => value.split(".").map((part) => Number.parseInt(part, 10));
const versionAtLeast = (actual, minimum) => {
  for (let i = 0; i < Math.max(actual.length, minimum.length); i += 1) {
    const a = actual[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

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
  assert.equal(manifest.nativeProjectStatus, "RN_0.86.0_BOOTSTRAPPED");
  assert.equal(manifest.dependencies["react-native"], "0.86.0");
  assert.equal(manifest.packageManager, "pnpm@11.7.0");
  assert.match(fs.readFileSync(path.join(mobile, "android", "gradle.properties"), "utf8"), /newArchEnabled=true/);
  assert.match(fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8"), /minSdkVersion = 24/);
  assert.match(fs.readFileSync(path.join(mobile, "android", "build.gradle"), "utf8"), /targetSdkVersion = 35/);
});

test("React Native upgrades keep the Gradle wrapper compatible with the Android plugin", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
  const reactNative = parseVersion(manifest.dependencies["react-native"]);
  const wrapper = fs.readFileSync(path.join(mobile, "android", "gradle", "wrapper", "gradle-wrapper.properties"), "utf8");
  const match = wrapper.match(/gradle-(\d+\.\d+(?:\.\d+)?)-bin\.zip/);
  assert.ok(match, "Gradle wrapper distribution must pin a concrete version");
  const gradle = parseVersion(match[1]);
  if (versionAtLeast(reactNative, [0, 87, 0])) {
    assert.equal(versionAtLeast(gradle, [9, 4, 1]), true, `React Native ${manifest.dependencies["react-native"]} requires Gradle >= 9.4.1; wrapper is ${match[1]}`);
  }
});

test("pull-request workflows cannot self-mutate and push their own branch", () => {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  for (const filename of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const source = fs.readFileSync(path.join(workflowsDir, filename), "utf8").replace(/\r\n/g, "\n");
    if (!/(^|\n)\s*pull_request\s*:/m.test(source)) continue;
    const grantsWrite = /(^|\n)\s*contents\s*:\s*write\s*$/m.test(source);
    const pushesGit = /(^|\n)\s*(?:run:\s*\|[\s\S]*?)?\bgit\s+push\b/m.test(source);
    assert.equal(grantsWrite && pushesGit, false, `${filename} must not grant contents: write and git push from a pull_request workflow; that creates synchronize/CI loops`);
  }
});

test("Android release networking fails closed without an unresolved manifest placeholder", () => {
  const manifest = fs.readFileSync(path.join(mobile, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  const gradle = fs.readFileSync(path.join(mobile, "android", "app", "build.gradle"), "utf8");
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
  assert.match(app, /Home: "HOME", Markets: "OBSERVE", Paper: "PAPER", Portfolio: "SUPERVISE"/);
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
  assert.equal(fs.existsSync(path.join(repoRoot, "scripts", "prepare-mobile-build-config.js")), true);
  assert.equal(fs.existsSync(path.join(mobile, "src", "generatedBuildConfig.ts")), true);
  assert.equal((workflow.match(/prepare-mobile-build-config\.js/g) ?? []).length, 2);
  assert.match(workflow, /android-debug:/);
  assert.match(workflow, /:app:assembleDebug -PnusaEmbedDebugBundle/);
  assert.match(workflow, /android-release-candidate:/);
  assert.match(workflow, /:app:assembleRelease/);
  assert.match(workflow, /ios-debug:\s*\r?\n\s*if: \$\{\{ false \}\}/);
  assert.match(workflow, /ios-release-candidate:\s*\r?\n\s*if: \$\{\{ false \}\}/);
  assert.match(workflow, /Android-only/);
  assert.doesNotMatch(workflow, /xcodebuild/);
});

test("Android networking layer replaces (not appends) the User-Agent so Upbit's public API stops rejecting requests with HTTP 400", () => {
  // Two prior JS-only fixes oscillated on this exact symptom: bd51b4a5 added a custom
  // "user-agent" fetch header because Upbit rejected OkHttp's generic default; 5bc750f2 later
  // removed it again because Upbit then rejected the duplicate that produced. Neither fix
  // could work reliably because React Native's Android bridge does not guarantee a fetch()
  // header replaces OkHttp's own rather than being sent alongside it. The single fix that
  // actually guarantees one non-generic header is a native OkHttp interceptor using `.header()`
  // (replace) instead of `.addHeader()` (append), registered before any request can be sent.
  const mainApplication = fs.readFileSync(
    path.join(mobile, "android", "app", "src", "main", "java", "com", "nusa", "mobile", "MainApplication.kt"),
    "utf8"
  );
  assert.match(mainApplication, /import com\.facebook\.react\.modules\.network\.OkHttpClientProvider/);
  assert.match(mainApplication, /class NusaUserAgentInterceptor : Interceptor/);
  assert.match(mainApplication, /\.header\("User-Agent", "nusa-mobile\/0\.1"\)/);
  assert.doesNotMatch(mainApplication, /\.addHeader\("User-Agent"/);
  // setOkHttpClient(OkHttpClient) does not exist on this API -- only the factory registration
  // does; getting this wrong compiles in an IDE with stale caches but fails Gradle's real
  // Kotlin compiler, which is exactly what happened here before this test existed.
  assert.match(mainApplication, /OkHttpClientProvider\.setOkHttpClientFactory/);
  assert.doesNotMatch(mainApplication, /OkHttpClientProvider\.setOkHttpClient\(/);
  const onCreate = mainApplication.slice(mainApplication.indexOf("override fun onCreate"));
  assert.ok(
    onCreate.indexOf("OkHttpClientProvider.setOkHttpClientFactory") < onCreate.indexOf("loadReactNative(this)"),
    "the patched OkHttp client factory must be installed before loadReactNative(this) starts the networking stack"
  );

  const quotationClient = fs.readFileSync(path.join(mobile, "src", "upbitPublicQuotationClient.ts"), "utf8");
  assert.doesNotMatch(quotationClient, /"user-agent"\s*:/);
});

test("native network diagnostics capture only URL/method/User-Agent, read-only, without touching the response", () => {
  const nativeDir = path.join(mobile, "android", "app", "src", "main", "java", "com", "nusa", "mobile");
  const diagnosticsKt = fs.readFileSync(path.join(nativeDir, "NusaNetworkDiagnostics.kt"), "utf8");
  const diagnosticsModule = fs.readFileSync(path.join(nativeDir, "NusaNetworkDiagnosticsModule.java"), "utf8");
  const mainApplication = fs.readFileSync(path.join(nativeDir, "MainApplication.kt"), "utf8");

  // The interceptor must capture the request it is about to send -- URL, method, the
  // already-replaced User-Agent -- and nothing else. Real-device diagnosis needs to be able to
  // tell "the interceptor never ran" (finalUserAgent comes back as OkHttp's own default, e.g.
  // "okhttp/...") apart from "the interceptor ran but Upbit still rejected it" (finalUserAgent
  // is "nusa-mobile/0.1" and the request still 400s) -- neither is possible without this.
  assert.match(mainApplication, /NusaNetworkDiagnostics\.record\(request\.url\.toString\(\), request\.method, request\.header\("User-Agent"\)\)/);
  assert.match(mainApplication, /add\(NusaNetworkDiagnosticsPackage\(\)\)/);

  // Only a request-side snapshot exists; there is no method here that could be used to write,
  // clear, or otherwise let JS influence what gets captured.
  assert.match(diagnosticsKt, /fun record\(requestUrl: String, method: String, userAgent: String\?\)/);
  assert.doesNotMatch(diagnosticsKt, /fun\s+(?!record|snapshot)\w+\(/);

  // The bridge module is read-only (a getter, no setter) and only ever names the three
  // non-secret fields -- it has no code path that could forward an arbitrary header map.
  assert.match(diagnosticsModule, /@ReactMethod[\s\S]*?public void getLastRequest\(Promise promise\)/);
  assert.doesNotMatch(diagnosticsModule, /@ReactMethod[\s\S]*?public void set\w*\(/i);
  for (const source of [diagnosticsKt, diagnosticsModule, mainApplication]) {
    assert.doesNotMatch(source, /Authorization|Cookie|Set-Cookie/i);
  }

  // The interceptor must return chain.proceed(request) directly -- reading the response body
  // here (e.g. response.body?.string()) would consume the one-shot stream the JS fetch() caller
  // still needs, breaking every successful request to add a diagnostic for failed ones.
  const interceptorBody = mainApplication.slice(
    mainApplication.indexOf("class NusaUserAgentInterceptor"),
    mainApplication.indexOf("class MainApplication")
  );
  assert.doesNotMatch(interceptorBody, /\.body\b/);
  assert.match(interceptorBody, /return chain\.proceed\(request\)/);
});

test("Android mobile workflow cancels obsolete runs and reuses safe dependency caches", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/mobile-native.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(workflow.includes("group: mobile-native-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}"), true);
  assert.equal(workflow.includes("cancel-in-progress: true"), true);
  assert.equal((workflow.match(/cache: pnpm/g) ?? []).length, 3);
  assert.equal((workflow.match(/cache: gradle/g) ?? []).length, 2);
  assert.equal(workflow.includes("if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'release-candidate')"), true);
});
