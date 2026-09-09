"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const SRC = join(__dirname, "..", "apps", "mobile", "src");
const files = readdirSync(SRC).filter((name) => name.endsWith(".tsx") && !name.includes(".test."));
const sources = files.map((name) => [name, readFileSync(join(SRC, name), "utf8")]);

/** The opening tag of each `<Pressable`, brace-aware so a style callback does not end it early. */
function pressableTags(source) {
  const tags = [];
  for (let index = source.indexOf("<Pressable"); index !== -1; index = source.indexOf("<Pressable", index + 1)) {
    let depth = 0;
    let cursor = index;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
      cursor += 1;
    }
    tags.push({ tag: source.slice(index, cursor + 1), line: source.slice(0, index).split("\n").length });
  }
  return tags;
}

test("every tappable element announces what it is", () => {
  for (const [name, source] of sources) {
    for (const { tag, line } of pressableTags(source)) {
      assert.match(tag, /accessibilityRole=/, `${name}:${line} has no accessibilityRole`);
    }
  }
});

test("a disabled control says so instead of only looking dimmer", () => {
  for (const [name, source] of sources) {
    for (const { tag, line } of pressableTags(source)) {
      if (!/\bdisabled=/.test(tag)) continue;
      assert.match(tag, /accessibilityState=/, `${name}:${line} dims without announcing disabled`);
    }
  }
});

test("no interactive element offers a target under 44", () => {
  // Chips, badges and rows may be smaller; these are the styles actually worn by a Pressable.
  // A element that stays small on purpose must widen its target with hitSlop instead.
  const heights = new Map();
  for (const [, source] of sources) {
    for (const match of source.matchAll(/^\s{2}([A-Za-z0-9_]+): \{([^}]*)\},?$/gm)) {
      const found = /minHeight: (\d+)/.exec(match[2]);
      if (found != null) heights.set(match[1], Number(found[1]));
    }
  }
  for (const [name, source] of sources) {
    for (const { tag, line } of pressableTags(source)) {
      if (/hitSlop=/.test(tag)) continue;
      for (const match of tag.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
        const height = heights.get(match[1]);
        if (height == null) continue;
        assert.ok(height >= 44, `${name}:${line} style "${match[1]}" is a ${height}px target with no hitSlop`);
      }
    }
  }
});

test("a deliberately small control widens its target rather than its drawing", () => {
  const surfaces = readFileSync(join(SRC, "instrumentSurfaces.tsx"), "utf8");
  // The spine is a band; a 44px lamp would make it a toolbar.
  assert.match(surfaces, /hitSlop=\{\{ top: 11, bottom: 11/);
  assert.match(surfaces, /lamp: \{[^}]*minHeight: 22/);
});

test("an 11px link keeps its size while its target does not", () => {
  const home = readFileSync(join(SRC, "homeView.tsx"), "utf8");
  assert.match(home, /inlineLinkTarget: \{ minHeight: 44/);
  assert.match(home, /style=\{styles\.inlineLinkTarget\}/);
});
