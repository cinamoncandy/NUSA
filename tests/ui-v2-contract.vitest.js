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

describe("NUSA UI/UX V2 canonical renderer", () => {
  it("uses the dedicated v2 renderer entry", () => {
    expect(rendererPath).toContain('index-v2.html');
    expect(html).toContain('id="simple-ui-root"');
    expect(html).toContain('class="v2-app"');
  });

  it("gives v2 exclusive presentation ownership while marking the temporary runtime binder", () => {
    expect(html).toContain('href="tokens.css"');
    expect(html).toContain('href="components.css"');
    expect(html).toContain('href="v2.css"');
    for (const asset of legacyPresentationAssets) expect(html).not.toContain(`href="${asset}"`);
    expect(html).toContain('data-runtime-compat="simple-ui"');
    expect(html).toContain('src="simple-ui.js"');
  });

  it("exposes exactly the five primary product destinations", () => {
    const primaryNav = html.match(/class="v2-nav__item[^>]*data-simple-nav="([^"]+)"/g) ?? [];
    expect(primaryNav).toHaveLength(5);
    for (const route of canonicalRoutes) expect(html).toContain(`class="v2-nav__item${route === "dashboard" ? " is-active" : ""}" data-simple-nav="${route}"`);
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

  it("does not create a second token system or reach into palette tokens", () => {
    expect(css).not.toMatch(/--simple-[\w-]+\s*:/);
    expect(css).not.toContain("--palette-");
    expect(css).toContain("hsl(var(--color-bg))");
    expect(css).toContain("hsl(var(--color-surface))");
  });

  it("preserves explicit Paper-only execution language without live activation controls", () => {
    expect(html).toContain("PAPER");
    expect(html).toContain("실거래가 아닌 Paper 주문입니다.");
    expect(html).toContain("Paper 매수");
    expect(html).toContain("Paper 매도");
    expect(html).toContain("실거래 권한은 없습니다");
    expect(html).not.toMatch(/data-(?:simple-)?(?:live|real)-(?:order|enable|activate)/i);
  });

  it("makes NUSA state a first-class home drilldown", () => {
    expect(html).toContain("<h2>NUSA 상태</h2>");
    expect(html).toContain("현재 전략과 자동화 상태를 확인합니다.");
    expect(html).toContain('class="v2-link" data-simple-nav="strategy">NUSA 상태 보기</button>');
  });

  it("keeps the trading workflow connected to history", () => {
    expect(html).toContain("시장 상태와 현재 포지션을 확인한 뒤 Paper 주문을 실행합니다.");
    expect(html).toContain('data-simple-nav="logs">전체 기록</button>');
  });

  it("supports dark and contrast themes without inventing a third mode", () => {
    expect(html).toContain('<option value="dark">Dark</option>');
    expect(html).toContain('<option value="contrast">Contrast</option>');
    expect(adapter).toContain('theme === "contrast" ? "contrast" : "dark"');
  });

  it("loads the compatibility adapter after the existing paper UI binder", () => {
    const binder = html.indexOf('src="simple-ui.js"');
    const adapterIndex = html.indexOf('src="v2-adapter.js"');
    expect(binder).toBeGreaterThan(-1);
    expect(adapterIndex).toBeGreaterThan(binder);
  });

  it("adds accessible dialog semantics to the Paper order confirmation sheet", () => {
    expect(html).toContain('id="v2-order-sheet-title"');
    expect(adapter).toContain('setAttribute("role", "dialog")');
    expect(adapter).toContain('setAttribute("aria-modal", "true")');
    expect(adapter).toContain('setAttribute("aria-labelledby", "v2-order-sheet-title")');
  });

  it("locks responsive touch, overflow, focus, and reduced-motion contracts", () => {
    expect(css).toContain("min-height:44px");
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media(max-width:720px)");
    expect(css).toContain("padding:var(--space-24) 14px 96px");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("uses the browser-scoped mutation observer required by the lint contract", () => {
    expect(adapter).toContain("new window.MutationObserver");
    expect(adapter).not.toMatch(/new\s+MutationObserver\s*\(/);
  });
});
