const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/mobile/src/eventBannerModel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { advanceBanner } = shim.exports;

const fill = (id, at) => ({ id, stage: "FILL", occurredAt: at, market: "KRW-BTC", status: "PASS", fill: { side: "BUY", quantity: 0.001, price: 5000, fee: 2 } });
const hold = (id, at) => ({ id, stage: "RISK", occurredAt: at, market: "KRW-BTC", status: "FAIL" });

test("banner model is import-free and deterministic", () => {
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /Date\.now/);
});

test("first confirmed snapshot, even empty, only sets the baseline", () => {
  const first = advanceBanner(null, [fill("a", 10)], false);
  assert.equal(first.banner, null);
  const empty = advanceBanner(null, [], false);
  assert.equal(empty.banner, null);
  const next = advanceBanner(empty.cursor, [fill("b", 20)], false);
  assert.equal(next.banner.id, "b");
  assert.match(next.banner.title, /BTC .* 매수 체결/);
});

test("ids, not timestamps: a new fill at an already seen time still banners", () => {
  const base = advanceBanner(null, [fill("a", 10)], false);
  assert.equal(advanceBanner(base.cursor, [fill("a", 10)], false).banner, null);
  assert.equal(advanceBanner(base.cursor, [fill("a", 10), fill("b", 10)], false).banner.id, "b");
});

test("a fill buried under many newer holds is still found", () => {
  const base = advanceBanner(null, [], false);
  const events = [fill("f", 5), ...Array.from({ length: 40 }, (_, i) => hold(`h${i}`, 10 + i))];
  assert.equal(advanceBanner(base.cursor, events, false).banner.id, "f");
});

test("halt banner comes from the runtime halt transition and wins over a fill", () => {
  const base = advanceBanner(null, [], false);
  const halted = advanceBanner(base.cursor, [fill("f", 5)], true);
  assert.equal(halted.banner.tone, "halt");
  assert.equal(advanceBanner(halted.cursor, [fill("f", 5)], true).banner, null);
});

test("banner is mounted once under the safety line on every tab", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(app.match(/<EventBanner /g).length, 1);
  assert.ok(app.indexOf("<EventBanner ") > app.indexOf("<SafetyLine "));
  assert.ok(app.indexOf("<EventBanner ") < app.indexOf("<TabTransition "));
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/eventBanner.tsx"), "utf8");
  assert.match(view, /accessibilityLiveRegion="assertive"/);
  assert.match(view, /accessibilityLabel=\{`PAPER\. /);
  assert.match(app, /<EventBanner ready=\{!paperProjectionPending && snapshot\?\.paperLearning != null\} sourceKey=\{getConfiguredPaperEndpoint\(\) \?\? ""\}/);
});
