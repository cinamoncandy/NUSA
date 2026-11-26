"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the 실거래 head carries the still corner sphere and keeps its text clear of it (UI v7 phase 8b)", () => {
  const view = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/safetyView.tsx"), "utf8");
  assert.match(view, /<InstrumentHero index="03 \/ 실거래" lines=\{\[\{ text: "실제 돈은" \}, \{ text: "안 움직여요" \}\]\} reserve=\{CORNER_SPHERE_RESERVE\} \/>/);
  assert.match(view, /<CornerSphere testID="safety-head-sphere" \/>/);
  assert.doesNotMatch(view, /HoloSphere/);
});
