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
const { bannerBaseline, pickBanner } = shim.exports;

const e = (id, at, kind) => ({ id, at, kind, title: `${kind} ${id}`, detail: "d" });

test("banner model is import-free", () => {
  assert.doesNotMatch(source, /^import /m);
});

test("baseline is the newest event so old events never banner", () => {
  const entries = [e("a", 10, "fill"), e("b", 30, "quiet"), e("c", 20, "halt")];
  assert.equal(bannerBaseline(entries), 30);
  assert.equal(pickBanner(entries, bannerBaseline(entries)), null);
  assert.equal(bannerBaseline([]), 0);
});

test("only new fills and halts banner; newest wins; halt wins a tie", () => {
  assert.equal(pickBanner([e("q", 50, "quiet"), e("h", 50, "hold")], 10), null);
  assert.equal(pickBanner([e("a", 20, "fill"), e("b", 40, "fill")], 10).id, "b");
  const tie = pickBanner([e("f", 40, "fill"), e("h", 40, "halt")], 10);
  assert.equal(tie.id, "h");
  assert.equal(tie.tone, "halt");
});

test("banner is mounted once under the safety line on every tab", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(app.match(/<EventBanner /g).length, 1);
  assert.ok(app.indexOf("<EventBanner ") > app.indexOf("<SafetyLine "));
  assert.ok(app.indexOf("<EventBanner ") < app.indexOf("<TabTransition "));
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/eventBanner.tsx"), "utf8");
  assert.match(view, /PAPER/);
});
