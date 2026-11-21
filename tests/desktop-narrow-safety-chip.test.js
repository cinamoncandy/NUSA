const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../apps/desktop/renderer/app.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../apps/desktop/renderer/index.html"), "utf8");

test("on a phone the PAPER / no-live chip stays readable: at least 11px, wraps, never cut by a max-width or ellipsis", () => {
  const phone = css.slice(css.indexOf("@media(max-width:720px)"), css.indexOf("@media(max-width:420px)"));
  const rule = phone.match(/\.v2-mode \{[^}]*\}/);
  assert.ok(rule, "the phone rule for the chip exists");
  assert.match(rule[0], /font-size: 11px/);
  assert.match(rule[0], /white-space: normal/);
  assert.doesNotMatch(rule[0], /text-overflow|max-width: \d+px/);
  const tiny = css.slice(css.indexOf("@media(max-width:420px)"), css.indexOf("@media(prefers-reduced-motion"));
  assert.doesNotMatch(tiny, /\.v2-mode \{[^}]*max-width/, "the narrowest breakpoint no longer caps the chip width");
  assert.match(html, /class="v2-mode" aria-label="Paper Trading · 실거래 비활성">PAPER · 실거래 비활성</);
});
