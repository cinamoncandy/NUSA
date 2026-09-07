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

test("historical command palette utilities search Korean and English aliases without disabled commands", () => {
  const commands = [
    { id: "focus", title: "집중 모드 켜기", keywords: ["focus"] },
    { id: "orders", title: "최근 체결로 이동", keywords: ["orders"] },
    { id: "start", title: "전략 시작", keywords: ["strategy"], enabled: false }
  ];
  assert.deepEqual(palette.filterCommands(commands, "FOCUS").map((command) => command.id), ["focus"]);
  assert.deepEqual(palette.filterCommands(commands, "체결").map((command) => command.id), ["orders"]);
  assert.deepEqual(palette.filterCommands(commands, "strategy"), []);
});

test("historical recent-command storage remains bounded and tolerant of corrupt data", () => {
  const clean = storage();
  ["one", "two", "three", "four", "five", "six", "three"].forEach((id) => palette.writeRecent(clean, id));
  assert.deepEqual(palette.readRecent(clean), ["three", "six", "five", "four", "two"]);
  assert.deepEqual(palette.readRecent(storage({ [palette.RECENT_KEY]: "not json" })), []);
});

test("canonical renderer does not load the retired command palette surface", () => {
  const html = read("apps/desktop/renderer/index.html");
  const runtime = read("apps/desktop/renderer/app-runtime.js");
  assert.doesNotMatch(html, /command-palette\.js|command-palette\.css|id="command-palette"/);
  assert.match(html, /src="app-runtime\.js"/);
  assert.match(runtime, /data-simple-nav/);
  assert.match(runtime, /data-simple-order/);
  assert.doesNotMatch(runtime, /ipcRenderer|LIVE TRADING ENABLED|withdraw|transfer/i);
});

test("historical palette styles remain tokenized and reduced-motion safe while dormant", () => {
  const css = read("apps/desktop/renderer/command-palette.css");
  assert.match(css, /var\(--z-modal\)/);
  assert.match(css, /var\(--color-surface\)/);
  assert.match(css, /max-width: 40rem/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
