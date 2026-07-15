const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const palette = require("../apps/desktop/renderer/command-palette.js");
const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const storage = () => { const values = new Map(); return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };

test("palette filters Korean and English aliases and excludes disabled commands", () => {
  const commands = [{ id: "focus", title: "집중 모드", keywords: ["focus"] }, { id: "start", title: "전략 시작", keywords: ["strategy"], enabled: false }];
  assert.deepEqual(palette.filter(commands, "FOCUS").map((item) => item.id), ["focus"]);
  assert.deepEqual(palette.filter(commands, "strategy"), []);
});

test("palette recent commands are bounded, de-duplicated, and fail closed on corrupt JSON", () => {
  const local = storage();
  ["one", "two", "three", "four", "five", "six", "three"].forEach((id) => palette.write(local, id));
  assert.deepEqual(palette.read(local), ["three", "six", "five", "four", "two"]);
  assert.deepEqual(palette.read({ getItem: () => "bad json", setItem: () => {} }), []);
});

test("renderer reuses existing controls and exposes accessible palette mechanics", () => {
  const html = read("apps/desktop/renderer/index.html");
  const renderer = read("apps/desktop/renderer/renderer.js");
  const script = read("apps/desktop/renderer/command-palette.js");
  assert.match(html, /id="command-palette"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="command-palette-search"[^>]*aria-controls="command-palette-list"/);
  assert.match(script, /event\.key==="Escape"/);
  assert.match(script, /ArrowDown/);
  assert.match(script, /event\.key==="Tab"/);
  assert.match(renderer, /toggleFocusMode/);
  assert.match(renderer, /byId\("strategy-start"\)\.click\(\)/);
  assert.match(renderer, /byId\("strategy-stop"\)\.click\(\)/);
  assert.doesNotMatch(renderer, /placeOrder\("BUY"|placeOrder\("SELL"/);
});
