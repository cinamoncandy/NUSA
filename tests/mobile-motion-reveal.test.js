const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(root, "apps/mobile/src", f), "utf8");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(src("revealStagger.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { revealDelayMs } = shim.exports;

test("reveal stagger is capped so long screens never make the user wait", () => {
  assert.equal(revealDelayMs(0, 55, 6), 0);
  assert.equal(revealDelayMs(3, 55, 6), 165);
  assert.equal(revealDelayMs(40, 55, 6), 330);
  assert.equal(revealDelayMs(-1, 55, 6), 0);
});

test("motion is app-wide, honours reduced motion and never animates money", () => {
  const frame = src("screenFrame.tsx");
  assert.match(frame, /<MotionReveal key=\{[^}]+\} index=\{index\}>/, "every ScreenFrame screen staggers its sections");
  const components = src("components.tsx");
  assert.match(components, /if \(reducedMotion\) \{ opacity\.setValue\(1\); translateY\.setValue\(0\); return; \}/);
  assert.match(components, /revealDelayMs\(index, fieldMotion\.revealStaggerMs, fieldMotion\.revealMaxIndex\)/);
  assert.match(src("homeView.tsx"), /krw\(account\?\.equity\)/, "money is shown verbatim, never animated or interpolated");
});
