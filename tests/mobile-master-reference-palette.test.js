"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { masterReferenceColors } = require("../dist/apps/mobile/src/designSystem.js");

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("the palette is the one sampled from the concept board", () => {
  // These are not design choices made here. Each was read off the owner-provided board, which is
  // the MASTER VISUAL REFERENCE for #536. Changing one means the board changed.
  assert.equal(masterReferenceColors.canvas, "#091012");
  assert.equal(masterReferenceColors.accent, "#D0F8B0");
  assert.equal(masterReferenceColors.accentSoft, "#9BDBA3");
  assert.equal(masterReferenceColors.accentMuted, "#B1E6AC");
  assert.equal(masterReferenceColors.onAccent, "#0B1210");
  assert.ok(Object.isFrozen(masterReferenceColors));
});

test("the accent is light, so it takes dark text and never white", () => {
  // The board's "View Full Analysis" button is a pale lime fill with dark text. Putting white on
  // this accent would fail AA badly, which is exactly the trap the old dark-teal accent did not have.
  assert.ok(contrast(masterReferenceColors.onAccent, masterReferenceColors.accent) >= 4.5, "text on an accent fill must meet WCAG AA");
  assert.ok(contrast("#FFFFFF", masterReferenceColors.accent) < 4.5, "white on this accent is unreadable and must not be used");
});

test("accent-on-canvas carries type at AA, so it can mark active state", () => {
  for (const key of ["accent", "accentSoft", "accentMuted"]) {
    assert.ok(contrast(masterReferenceColors[key], masterReferenceColors.canvas) >= 4.5, `${key} on canvas must meet WCAG AA`);
  }
});
