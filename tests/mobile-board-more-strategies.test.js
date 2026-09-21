"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", p), "utf8");
const more = read("src/moreMenuView.tsx");
const strategies = read("src/strategiesView.tsx");
const app = read("App.tsx");

test("More renders the board's authority footer as readable text", () => {
  // The concept board prints PAPER ONLY / AI ZERO AUTHORITY / REAL DATA ONLY on its More screen.
  // That is a safety declaration, so assert the words and the style they render under: this branch
  // has already had declarations degenerate into 1x1 opacity-0 nodes that satisfied a marker while
  // showing the owner nothing.
  for (const line of ["PAPER ONLY", "AI ZERO AUTHORITY", "REAL DATA ONLY"]) {
    assert.match(more, new RegExp(`<Text style=\\{styles\\.authorityLine\\}>${line}</Text>`), `More must declare ${line}`);
  }
  const style = /authorityLine: \{([^}]*)\}/.exec(more);
  assert.ok(style, "the authority lines must use a declared style");
  assert.doesNotMatch(style[1], /opacity:\s*0\b/, "the authority footer must not be invisible");
  assert.doesNotMatch(style[1], /(width|height):\s*[01]\b/, "the authority footer must not be collapsed");
});

test("More is the only route to the deeper screens the board moved off the tab bar", () => {
  for (const destination of ["PAPER", "PERFORMANCE", "HISTORY", "NOTIFICATIONS", "SETTINGS"]) {
    assert.match(more, new RegExp(`key: "${destination}"`), `${destination} must be reachable from More`);
    assert.match(app, new RegExp(`utilityView === "${destination}" \\?`), `${destination} must be routed`);
  }
  assert.match(app, /const tabs = \["Home", "Market", "Signals", "Strategies", "More"\] as const;/);
});

test("Strategies shows only what the research session proves", () => {
  // The board's Strategies screen lists returns. The runtime has none per strategy, so the screen
  // says so rather than computing something presentable.
  assert.match(strategies, /수익률 —/);
  assert.match(strategies, /런타임이 전략별 수익률을 제공하지 않습니다\./);
  assert.match(strategies, /NO VERIFIED STRATEGY DATA/);
  assert.match(strategies, /research === null/);
  assert.doesNotMatch(strategies, /Math\.random|toFixed\(2\)\s*\+\s*"%"/);
  // Champion and challenger carry their own authority from the contract, never a widened one.
  assert.match(strategies, /authority: research\.champion\.authority/);
  assert.match(strategies, /authority: research\.challenger\.authority/);
  assert.match(strategies, /PAPER ONLY · LIVE \{research\?\.liveAuthority \?\? "NONE"\} · AI ZERO AUTHORITY/);
});
