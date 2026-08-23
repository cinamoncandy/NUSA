const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("native root mounts the application behind a last-resort render boundary", () => {
  const index = read("apps/mobile/index.js");
  assert.match(index, /import \{ AppErrorBoundary \} from "\.\/src\/AppErrorBoundary"/);
  assert.match(index, /return <AppErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/AppErrorBoundary>/);
  assert.match(index, /AppRegistry\.registerComponent\(appName, \(\) => Root\)/);
});

test("native root exposes the packaged source fingerprint without moving App outside the error boundary", () => {
  const index = read("apps/mobile/index.js");
  assert.match(index, /import \{ BUILD_SOURCE_SHA \} from "\.\/src\/generatedBuildConfig"/);
  assert.match(index, /testID="runtime-build-fingerprint"/);
  assert.match(index, /NUSA BUILD \{shortBuildSha\}/);
  assert.match(index, /<AppErrorBoundary>[\s\S]*<App \/>[\s\S]*runtime-build-fingerprint[\s\S]*<\/AppErrorBoundary>/);
});

test("render boundary exposes a minimal accessible manual recovery path", () => {
  const source = read("apps/mobile/src/AppErrorBoundary.tsx");
  assert.match(source, /class AppErrorBoundary extends React\.Component/);
  assert.match(source, /static getDerivedStateFromError/);
  assert.match(source, /accessibilityLiveRegion="assertive"/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /testID="app-error-retry"/);
  assert.match(source, /minHeight: 48/);
  assert.match(source, /retryKey: current\.retryKey \+ 1/);
  assert.match(source, /<React\.Fragment key=\{this\.state\.retryKey\}>/);
});

test("render fallback does not expose exception text, credentials, or authority mutation", () => {
  const source = read("apps/mobile/src/AppErrorBoundary.tsx");
  assert.doesNotMatch(source, /error\.message|stack|credentialProvider|authorization|Bearer/);
  assert.doesNotMatch(source, /productionMutationAllowed\s*:\s*true|liveAuthority\s*:\s*"LIVE"|submitPersonalPaperOrder/);
  assert.match(source, /거래 권한이나 안전 설정은 변경되지 않았습니다/);
});
