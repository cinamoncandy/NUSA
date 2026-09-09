"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const SRC = join(__dirname, "..", "apps", "mobile", "src");
const files = readdirSync(SRC).filter((name) => (name.endsWith(".tsx") || name.endsWith(".ts")) && !name.includes(".test."));
const sources = files.map((name) => [name, readFileSync(join(SRC, name), "utf8")]);
const COMPONENTS = readFileSync(join(SRC, "components.tsx"), "utf8");

/**
 * In an instrument, movement is a signal rather than decoration: something that moves while
 * nothing changed spends the attention the next real change will need. These rules already
 * hold in the code; the tests exist so they cannot be undone quietly.
 */

test("nothing loops -- no blinking lamps, no shimmering skeletons", () => {
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /Animated\.loop/, `${name} must not run a looping animation`);
    assert.doesNotMatch(source, /iterations:\s*(-1|Infinity)/, `${name} must not repeat an animation forever`);
  }
});

test("a loading placeholder is a still block, not a moving one", () => {
  const skeleton = COMPONENTS.slice(COMPONENTS.indexOf("export function Skeleton"));
  const body = skeleton.slice(0, skeleton.indexOf("\n}"));
  assert.doesNotMatch(body, /Animated|useEffect|setInterval/, "a skeleton must not animate");
});

test("motion asks the device before it moves, and stays brief", () => {
  assert.match(COMPONENTS, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(COMPONENTS, /addEventListener\("reduceMotionChanged"/);
  // 180ms is the spec: long enough to read as a transition, short enough not to be waited on.
  assert.match(COMPONENTS, /duration: 180/);
});

test("numbers are replaced, never rolled", () => {
  // A number mid-roll is a value that was never true. The freshness surfaces animate a bar and
  // a colour; the figure itself swaps outright.
  const surfaces = readFileSync(join(SRC, "instrumentSurfaces.tsx"), "utf8");
  assert.doesNotMatch(surfaces, /Animated/, "instrument surfaces must not animate a value");
  assert.match(surfaces, /useNowMs/);
});

test("the tick is a whole second, so a displayed age is never a fraction of one", () => {
  const surfaces = readFileSync(join(SRC, "instrumentSurfaces.tsx"), "utf8");
  assert.match(surfaces, /export function useNowMs\(intervalMs = 1_000\)/);
});
