const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const palette = require("../apps/desktop/renderer/command-palette.js");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
};

test("palette searches Korean and English aliases while retaining disabled commands", () => {
  const commands = [
    { id: "focus", title: "Focus mode", keywords: ["집중", "focus"] },
    { id: "start", title: "Start strategy", keywords: ["전략", "strategy"], enabled: false, disabledReason: "Unavailable" }
  ];
  assert.deepEqual(palette.filter(commands, "FOCUS").map((item) => item.id), ["focus"]);
  assert.deepEqual(palette.filter(commands, "strategy").map((item) => item.id), ["start"]);
});

test("keyboard selection skips disabled commands for arrows, Home, and End", () => {
  const commands = [{ id: "blocked", enabled: false }, { id: "first" }, { id: "second" }, { id: "last", enabled: false }];
  assert.equal(palette.nextEnabledIndex(commands, -1, "FIRST"), 1);
  assert.equal(palette.nextEnabledIndex(commands, -1, "LAST"), 2);
  assert.equal(palette.nextEnabledIndex(commands, 1, "NEXT"), 2);
  assert.equal(palette.nextEnabledIndex(commands, 2, "NEXT"), 1);
  assert.equal(palette.nextEnabledIndex(commands, 1, "PREVIOUS"), 2);
  assert.equal(palette.nextEnabledIndex([{ id: "blocked", enabled: false }], -1, "FIRST"), -1);
});

test("recent commands are bounded, newest-first, de-duplicated, and storage failures are non-fatal", () => {
  const local = storage();
  ["one", "two", "three", "four", "five", "six", "three"].forEach((id) => palette.write(local, id));
  assert.deepEqual(palette.read(local), ["three", "six", "five", "four", "two"]);
  assert.deepEqual(palette.read({ getItem: () => "bad json", setItem: () => {} }), []);
  assert.doesNotThrow(() => palette.write({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, "focus"));
});

test("focus trap, focus restoration, and focus targets are encoded in the renderer contract", () => {
  const html = read("apps/desktop/renderer/index.html");
  const script = read("apps/desktop/renderer/command-palette.js");
  assert.match(html, /id="command-palette"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="command-palette-search"[^>]*aria-controls="command-palette-list"/);
  assert.match(html, /id="orders" tabindex="-1"/);
  assert.match(html, /id="events" class="events" tabindex="-1"/);
  assert.match(html, /id="ai-cio-dashboard"[^>]*tabindex="-1"/);
  assert.match(script, /previousFocus = document\.activeElement/);
  assert.match(script, /previousFocus\?\.focus\?\.\(\)/);
  assert.match(script, /event\.key === "Tab"/);
  assert.match(script, /event\.key === "ArrowDown"/);
  assert.match(script, /event\.key === "ArrowUp"/);
  assert.match(script, /event\.key === "Home"/);
  assert.match(script, /event\.key === "End"/);
  assert.match(script, /event\.key === "Enter"/);
  assert.match(script, /event\.key === "Escape"/);
});

test("palette creates options with DOM nodes and exposes disabled reasons without HTML injection", () => {
  const script = read("apps/desktop/renderer/command-palette.js");
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /insertAdjacentHTML/);
  assert.doesNotMatch(script, /<span|<button|<li/);
  assert.match(script, /textContent = value/);
  assert.match(script, /option\.disabled = disabled/);
  assert.match(script, /command\.disabledReason \|\| unavailableLabel/);
});
