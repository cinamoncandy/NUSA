const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "desktop", "renderer");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "brand-ui.css"), "utf8");
const brandScript = fs.readFileSync(path.join(root, "brand-ui.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "preload.ts"), "utf8");

test("A4P brand shell exposes stable navigation and preserves safety surfaces", () => {
  for (const target of ["dashboard", "market", "shadow-session", "orders", "portfolio", "risk", "recovery", "evidence", "diagnostics", "settings", "about"]) {
    assert.match(html, new RegExp(`data-nav-target="${target}"`));
  }
  assert.match(html, /assets\/dokkaebi-a4p-symbol\.svg/);
  assert.match(html, /assets\/dokkaebi-a4p-lockup\.svg/);
  assert.match(html, /id="a4-diagnostics"/);
  assert.match(html, /id="recovery-review"/);
  assert.match(html, /LIVE TRADING DISABLED/);
});

test("A4P design tokens cover brand, semantic state, spacing, type, and motion", () => {
  for (const token of ["--brand-bg", "--brand-surface", "--brand-raised", "--brand-border", "--brand-text", "--brand-secondary", "--brand-muted", "--brand-accent", "--brand-safe", "--brand-warn", "--brand-danger", "--brand-info", "--brand-shadow", "--brand-radius", "--brand-space"]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-width: 760px|1050px/);
  assert.match(css, /focus-visible/);
});

test("A4P navigation is presentation-only and cannot introduce arbitrary IPC", () => {
  assert.match(html, /brand-ui\.js/);
  assert.match(brandScript, /scrollIntoView/);
  assert.doesNotMatch(brandScript, /ipcRenderer|invoke\(|shadow:start|paper:order/);
  for (const channel of ["paper:order", "shadow:start", "recovery:reconcile", "recovery:complete"]) assert.match(preload, new RegExp(channel.replace(":", "\\:")));
});

test("A4P keeps evidence and recovery as visible destinations without delete controls", () => {
  assert.match(html, /data-nav-target="evidence"/);
  assert.match(html, /data-nav-target="recovery"/);
  assert.doesNotMatch(html, /delete-evidence|evidence-delete|deleteEvidence/);
});

test("A4P brand assets and status language are explicit", () => {
  for (const asset of ["dokkaebi-a4p-symbol.svg", "dokkaebi-a4p-lockup.svg", "dokkaebi-a4p-monochrome.svg"]) {
    assert.ok(fs.existsSync(path.join(root, "assets", asset)), asset);
  }
  assert.ok(fs.existsSync(path.join(__dirname, "..", "build", "dokkaebi-a4p.ico")));
  assert.match(brandScript, /STATUS_PRESENTATION/);
  for (const code of ["PASS", "RUNNING", "RECONNECTING", "HALT", "REJECT", "BLOCKED", "COMPLETED", "RECOVERY_REQUIRED", "MATCHED", "MISMATCHED", "ERROR", "NOT_RUN"]) {
    assert.match(brandScript, new RegExp(`${code}:`));
  }
  assert.match(css, /overflow-wrap: anywhere/);
});

test("A4P long session values have a copy affordance and keyboard-visible focus", () => {
  assert.match(brandScript, /data-copy-value/);
  assert.match(css, /cr-long-value/);
  assert.match(css, /focus-visible/);
  assert.match(html, /aria-label="Primary navigation"/);
  assert.match(fs.readFileSync(path.join(root, "product-screens.js"), "utf8"), /product-row__copy/);
});
