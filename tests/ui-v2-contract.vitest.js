import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const html = read("apps/desktop/renderer/index-v2.html");
const css = read("apps/desktop/renderer/v2.css");
const adapter = read("apps/desktop/renderer/v2-adapter.js");
const rendererPath = read("apps/desktop/src/rendererPath.ts");

const legacyPresentationAssets = [
  "simple-ui.css",
  "brand-ui.css",
  "workspace.css",
  "control-room.css",
  "product-screens.css",
  "application-state.css",
  "command-palette.css",
  "styles.css"
];

const canonicalRoutes = ["dashboard", "orders", "positions", "strategy", "logs"];

describe("NUSA canonical desktop UI", () => {
  it("uses one canonical renderer entry", () => {
    expect(rendererPath).toContain("index-v2.html");
    expect(html).toContain('id="simple-ui-root"');
    expect(html).toContain('class="v2-app"');
  });

  it("gives the canonical renderer exclusive presentation ownership", () => {
    expect(html).toContain('href="tokens.css"');
    expect(html).toContain('href="components.css"');
    expect(html).toContain('href="v2.css"');
    for (const asset of legacyPresentationAssets) expect(html).not.toContain(`href="${asset}"`);
    expect(html).toContain('data-runtime-compat="simple-ui"');
    expect(html).toContain('src="simple-ui.js"');
  });

  it("exposes exactly five primary product destinations", () => {
    const primaryNav = html.match(/class="v2-nav__item[^>]*data-simple-nav="([^"]+)"/g) ?? [];
    expect(primaryNav).toHaveLength(5);
    for (const route of canonicalRoutes) expect(html).toContain(`data-simple-nav="${route}"`);
  });

  it("keeps settings separate and reachable on mobile", () => {
    expect(html).toContain('class="v2-settings"');
    expect(html).toContain('data-simple-nav="settings"');
    expect(html).toContain('aria-label="설정 열기"');
    expect(css).toContain(".v2-settings{display:block;position:fixed;top:10px;right:10px");
  });

  it("keeps legacy deep links as redirects rather than primary destinations", () => {
    expect(adapter).toContain('page === "market" ? "orders"');
    expect(adapter).toContain('page === "balance" ? "positions"');
    expect(adapter).toContain('page === "more" ? "settings"');
    for (const route of ["market", "balance", "more"]) {
      expect(html).not.toContain(`class="v2-nav__item" data-simple-nav="${route}"`);
    }
  });

  it("uses semantic design tokens without a private palette", () => {
    expect(css).not.toMatch(/--simple-[\w-]+\s*:/);
    expect(css).not.toContain("--palette-");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain("hsl(var(--color-bg))");
    expect(css).toContain("hsl(var(--color-surface))");
  });

  it("makes Paper mode impossible to confuse with live execution", () => {
    expect(html).toContain("PAPER · 실거래 비활성");
    expect(html).toContain("이 화면의 주문은 모두 Paper Trading입니다. 실거래 주문을 전송하지 않습니다.");
    expect(html).toContain("Paper 매수");
    expect(html).toContain("Paper 매도");
    expect(html).toContain("실거래 권한은 없으며 REAL/LIVE 상태를 추론하거나 활성화하지 않습니다.");
    expect(html).not.toMatch(/data-(?:simple-)?(?:live|real)-(?:order|enable|activate)/i);
  });

  it("does not fabricate NUSA confidence, AI judgment, or a risk gate", () => {
    expect(html).toContain("NUSA 운영 상태");
    expect(html).toContain("실제 runtime이 제공하는 전략·자동화·시장 연결 상태만 표시합니다.");
    expect(html).not.toContain("신뢰도");
    expect(html).not.toContain("Risk Gate");
    expect(html).not.toContain("NUSA 판단</span>");
  });

  it("keeps the main user flow explicit from result to action to history", () => {
    expect(html).toContain("자산 결과와 NUSA 운영 상태를 먼저 확인합니다.");
    expect(html).toContain("가격 → 상태 → 주문 → 기록 순서로 확인합니다.");
    expect(html).toContain('data-simple-nav="logs">전체 기록</button>');
  });

  it("keeps settings presentation-only with no authority promise", () => {
    expect(html).toContain("화면과 진단 표시만 조정합니다. 실행 권한은 변경하지 않습니다.");
    expect(html).not.toMatch(/실거래\s*(활성|사용|켜기)/);
  });

  it("supports only dark and contrast themes", () => {
    expect(html).toContain('<option value="dark">Dark</option>');
    expect(html).toContain('<option value="contrast">Contrast</option>');
    expect(adapter).toContain('theme === "contrast" ? "contrast" : "dark"');
  });

  it("loads the temporary runtime compatibility binder before the adapter", () => {
    const binder = html.indexOf('src="simple-ui.js"');
    const adapterIndex = html.indexOf('src="v2-adapter.js"');
    expect(binder).toBeGreaterThan(-1);
    expect(adapterIndex).toBeGreaterThan(binder);
  });

  it("adds accessible Paper order confirmation dialog semantics", () => {
    expect(html).toContain('id="v2-order-sheet-title"');
    expect(html).toContain('aria-label="Paper 주문 확인"');
    expect(adapter).toContain('setAttribute("role", "dialog")');
    expect(adapter).toContain('setAttribute("aria-modal", "true")');
    expect(adapter).toContain('setAttribute("aria-labelledby", "v2-order-sheet-title")');
  });

  it("gives scrollable tables keyboard access and explicit region labels", () => {
    expect(html).toContain('tabindex="0" role="region" aria-label="현재 포지션 표"');
    expect(html).toContain('tabindex="0" role="region" aria-label="보유 포지션 표"');
    expect(css).toContain("overscroll-behavior-inline:contain");
    expect(css).toContain("scrollbar-gutter:stable");
  });

  it("handles long financial values without breaking the layout", () => {
    expect(css).toContain("font-variant-numeric:tabular-nums");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("font-size:clamp(20px,2.1vw,26px)");
  });

  it("locks laptop tablet mobile and narrow-phone breakpoints", () => {
    expect(css).toContain("@media(max-width:1280px)");
    expect(css).toContain("@media(max-width:1100px)");
    expect(css).toContain("@media(max-width:720px)");
    expect(css).toContain("@media(max-width:420px)");
    expect(css).toContain("min-height:44px");
    expect(css).toContain("padding:var(--space-24) 14px 96px");
  });

  it("keeps focus visible, horizontal overflow contained, and motion reducible", () => {
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain("animation-duration:.01ms!important");
  });

  it("provides unified loading, disconnected, and error-state presentation hooks", () => {
    expect(css).toContain('[data-state="loading"] .simple-empty::before');
    expect(css).toContain('[data-state="error"] .simple-empty');
    expect(css).toContain('[data-state="disconnected"] .simple-empty');
  });

  it("uses the browser-scoped mutation observer required by lint", () => {
    expect(adapter).toContain("new window.MutationObserver");
    expect(adapter).not.toMatch(/new\s+MutationObserver\s*\(/);
  });
});
