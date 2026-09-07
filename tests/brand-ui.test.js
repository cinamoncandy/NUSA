const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "desktop", "renderer");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "app.css"), "utf8");
const runtime = fs.readFileSync(path.join(root, "app-runtime.js"), "utf8");

test("canonical NUSA shell exposes stable user navigation and explicit safety state", () => {
  for (const target of ["dashboard", "orders", "positions", "strategy", "logs", "settings"]) {
    assert.match(html, new RegExp(`data-simple-nav="${target}"`));
  }
  for (const page of ["dashboard", "orders", "positions", "strategy", "logs", "settings"]) {
    assert.match(html, new RegExp(`data-simple-page="${page}"`));
  }
  assert.match(html, /assets\/nusa-a4p-symbol\.svg/);
  assert.match(html, /PAPER · 실거래 비활성/);
  assert.match(html, /실거래 주문을 전송하지 않습니다/);
  assert.match(html, /실거래 권한은 없으며 REAL\/LIVE 상태를 추론하거나 활성화하지 않습니다/);
});

test("active renderer converges on one canonical presentation layer", () => {
  assert.match(html, /href="tokens\.css"/);
  assert.match(html, /href="components\.css"/);
  assert.match(html, /href="app\.css"/);
  assert.match(html, /src="app-runtime\.js"/);
  assert.match(html, /src="app-adapter\.js"/);
  assert.match(html, /src="app-accessibility\.js"/);
  for (const retired of ["brand-ui.js", "workspace.js", "product-screens.js", "control-room.js", "simple-ui.js", "command-palette.js", "renderer.js"]) {
    assert.doesNotMatch(html, new RegExp(retired.replace(".", "\\.")));
  }
});

test("canonical navigation is presentation-only and uses declared page routing", () => {
  assert.match(runtime, /data-simple-nav/);
  assert.match(runtime, /data-simple-page/);
  assert.match(runtime, /aria-current/);
  assert.match(runtime, /history\.replaceState/);
  assert.doesNotMatch(runtime, /ipcRenderer|shadow:start|recovery:complete|recovery:owner-review/);
});

test("canonical UI keeps keyboard and reduced-motion accessibility", () => {
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /aria-label="주요 메뉴"/);
  assert.match(html, /aria-label="작업 공간"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
});

test("canonical consumer surface does not expose retired admin authority destinations", () => {
  for (const retired of ["shadow-session", "recovery", "evidence", "diagnostics"]) {
    assert.doesNotMatch(html, new RegExp(`data-simple-nav="${retired}"`));
    assert.doesNotMatch(html, new RegExp(`data-nav-target="${retired}"`));
  }
  assert.doesNotMatch(html, /delete-evidence|evidence-delete|deleteEvidence/);
  assert.doesNotMatch(html, /recovery:owner-review|recovery:complete/);
});
