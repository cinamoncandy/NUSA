"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../dist/apps/mobile/src/auraMotion.js");

test("entrance progress is 0 before the delay, eases to exactly 1, and never leaves 0..1", () => {
  assert.equal(m.entranceProgress(0, 300, 600), 0);
  assert.equal(m.entranceProgress(299, 300, 600), 0);
  const mid = m.entranceProgress(600, 300, 600);
  assert.ok(mid > 0.5 && mid < 1, "ease-out is past halfway at the halfway time");
  assert.equal(m.entranceProgress(900, 300, 600), 1);
  assert.equal(m.entranceProgress(99999, 300, 600), 1);
  assert.equal(m.entranceProgress(10, 0, 0), 1, "no duration means already done");
  assert.equal(m.entranceProgress(10, 0, Number.NaN), 1);
  assert.equal(m.entranceProgress(Number.NaN, 0, 600), 0);
});

test("the revealed count rises monotonically to exactly the total and never past it", () => {
  assert.equal(m.revealedCount(15, 0), 0);
  assert.equal(m.revealedCount(15, 1), 15);
  assert.equal(m.revealedCount(15, 7), 15);
  assert.equal(m.revealedCount(15, -1), 0);
  assert.equal(m.revealedCount(0, 0.5), 0);
  assert.equal(m.revealedCount(1.5, 0.5), 0);
  let last = 0;
  for (let i = 0; i <= 100; i += 1) { const c = m.revealedCount(15, i / 100); assert.ok(c >= last && c <= 15); last = c; }
});

test("the aura components animate only through the one-shot hook, which honours reduce-motion, and never loop", () => {
  const kit = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/auraKit.tsx"), "utf8");
  assert.match(kit, /if \(reduced === null\) return undefined;/);
  assert.match(kit, /if \(reduced\) \{ setProgress\(1\); return undefined; \}/);
  assert.match(kit, /if \(p < 1\) frame = requestAnimationFrame\(step\)/);
  assert.doesNotMatch(kit, /setInterval|Animated\.loop|repeat/);
  const panels = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/learningPanels.tsx"), "utf8");
  assert.equal((panels.match(/<Entering index=/g) || []).length, 5, "every card enters through Reveal");
});

test("every Points draw in the aura kit is guarded against an empty list (Skia throws 'Points array must not be empty')", () => {
  const kit = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/auraKit.tsx"), "utf8");
  const draws = kit.split("\n").filter((line) => line.includes("<Points"));
  assert.ok(draws.length >= 6);
  for (const line of draws) assert.match(line, /nonEmpty\(/, line.trim().slice(0, 80));
});
