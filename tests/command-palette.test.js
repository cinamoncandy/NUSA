const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const palette = require("../apps/desktop/renderer/command-palette.js");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
};

test("command palette searches Korean and English aliases without disabled commands", () => {
  const commands = [
    { id: "focus", title: "집중 모드 켜기", keywords: ["focus"] },
    { id: "orders", title: "최근 체결로 이동", keywords: ["orders"] },
    { id: "start", title: "전략 시작", keywords: ["strategy"], enabled: false }
  ];
  assert.deepEqual(palette.filterCommands(commands, "FOCUS").map((command) => command.id), ["focus"]);
  assert.deepEqual(palette.filterCommands(commands, "체결").map((command) => command.id), ["orders"]);
  assert.deepEqual(palette.filterCommands(commands, "strategy"), []);
});

test("recent commands are bounded, de-duplicated, and tolerate corrupt storage", () => {
  const clean = storage();
  ["one", "two", "three", "four", "five", "six", "three"].forEach((id) => palette.writeRecent(clean, id));
  assert.deepEqual(palette.readRecent(clean), ["three", "six", "five", "four", "two"]);
  assert.deepEqual(palette.readRecent(storage({ [palette.RECENT_KEY]: "not json" })), []);
});

test("renderer contract wires keyboard access without creating order commands", () => {
  const html = read("apps/desktop/renderer/index.html");
  const renderer = read("apps/desktop/renderer/renderer.js");
  const script = read("apps/desktop/renderer/command-palette.js");
  assert.match(html, /id="command-palette"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="command-palette-search"[^>]*aria-controls="command-palette-list"/);
  assert.match(script, /\(event\.ctrlKey \|\| event\.metaKey\).*"k"/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key === "ArrowDown"/);
  assert.match(script, /event\.key === "Tab"/);
  assert.doesNotMatch(renderer, /placeOrder\("BUY"|placeOrder\("SELL"/);
  assert.match(renderer, /focus-order-quantity/);
  assert.match(renderer, /byId\("strategy-start"\)\.click\(\)/);
  assert.match(renderer, /byId\("strategy-stop"\)\.click\(\)/);
});

test("palette styles use tokens and preserve reduced motion handling", () => {
  const css = read("apps/desktop/renderer/command-palette.css");
  assert.match(css, /var\(--z-modal\)/);
  assert.match(css, /var\(--color-surface\)/);
  assert.match(css, /max-width: 40rem/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
