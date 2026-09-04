const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describeBuildIdentity } = require("../dist/apps/mobile/src/buildIdentity.js");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("sealed builds are recognized only with a full SHA and HTTPS origin", () => {
  const sealed = describeBuildIdentity("a".repeat(40), "https://nusa-api.duckdns.org");
  assert.equal(sealed.sealed, true);
  assert.equal(sealed.shortSha, "aaaaaaaa");
  assert.ok(sealed.label.includes("aaaaaaaa"));
  assert.equal(describeBuildIdentity("unprepared", "").sealed, false);
  assert.equal(describeBuildIdentity("unprepared", "").shortSha, "dev");
  assert.equal(describeBuildIdentity("a".repeat(40), "http://127.0.0.1:41731").sealed, false);
  assert.equal(describeBuildIdentity("abc123", "https://nusa-api.duckdns.org").sealed, false);
  assert.equal(describeBuildIdentity("  " + "b".repeat(40) + "  ", "https://x.example").shortSha, "bbbbbbbb");
  assert.ok(Object.isFrozen(sealed));
});

test("shipped Settings surface carries the build seal", () => {
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(settings, /describeBuildIdentity/);
  assert.match(settings, /testID="settings-build-seal"/);
  assert.match(settings, /개발\/미봉인 빌드/);
});

test("App passes its verified session into TradingView", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /<TradingView error=\{readOnlyError\} credentialSession=\{credentialSession\}/);
  const trading = read("apps/mobile/src/tradingView.tsx");
  assert.match(trading, /credentialSession\?: InMemoryDashboardCredentialSession/);
  assert.match(trading, /props\.credentialSession \?\? fallbackSession/);
});

test("release builds require sealed identity at Gradle evaluation", () => {
  const gradle = read("apps/mobile/android/app/build.gradle");
  assert.match(gradle, /NUSA_BUILD_SHA_REQUIRED_FOR_RELEASE/);
  assert.match(gradle, /NUSA_BUILD_NUMBER_REQUIRED_FOR_RELEASE/);
  assert.match(gradle, /\^?\[0-9a-fA-F\]\{40\}\$/);
});
