import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("apps/desktop/renderer/index.html");
const css = read("apps/desktop/renderer/app.css");
const runtime = read("apps/desktop/renderer/app-runtime.js");
const adapter = read("apps/desktop/renderer/app-adapter.js");
const accessibility = read("apps/desktop/renderer/app-accessibility.js");
const rendererPath = read("apps/desktop/src/rendererPath.ts");
const canonicalRoutes = ["dashboard", "orders", "positions", "strategy", "logs"];

const retiredAssets = ["simple-ui.js", "simple-ui.css", "v2.css", "v2-adapter.js", "index-v2.html"];
const inactiveLegacyPresentationAssets = ["brand-ui.css", "workspace.css", "control-room.css", "product-screens.css", "application-state.css", "command-palette.css", "styles.css"];

describe("NUSA final canonical desktop UI", () => {
  it("uses index.html as the single canonical renderer entry", () => {
    expect(rendererPath).toContain("renderer/index.html");
    expect(html).toContain('data-runtime-owner="canonical"');
    expect(html).toContain('data-testid="nusa-app-root"');
  });

  it("loads only canonical renderer assets", () => {
    expect(html).toContain('href="tokens.css"');
    expect(html).toContain('href="components.css"');
    expect(html).toContain('href="app.css"');
    expect(html).toContain('src="app-runtime.js"');
    expect(html).toContain('src="app-adapter.js"');
    expect(html).toContain('src="app-accessibility.js"');
    for (const asset of [...retiredAssets, ...inactiveLegacyPresentationAssets]) {
      expect(html).not.toContain(`src="${asset}"`);
      expect(html).not.toContain(`href="${asset}"`);
    }
    expect(html).not.toContain('data-runtime-compat="simple-ui"');
  });

  it("exposes exactly five primary destinations with settings outside primary nav", () => {
    const primaryNav = html.match(/class="v2-nav__item[^>]*data-simple-nav="([^"]+)"/g) ?? [];
    expect(primaryNav).toHaveLength(5);
    for (const route of canonicalRoutes) expect(html).toContain(`data-simple-nav="${route}"`);
    expect(html).toContain('class="v2-settings"');
  });

  it("normalizes old deep links inside the canonical runtime", () => {
    expect(runtime).toContain('market: "orders"');
    expect(runtime).toContain('balance: "positions"');
    expect(runtime).toContain('more: "settings"');
  });

  it("uses semantic design tokens without a private literal palette", () => {
    expect(css).not.toMatch(/--simple-[\w-]+\s*:/);
    expect(css).not.toContain("--palette-");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(runtime).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(runtime).toContain('polyline.setAttribute("stroke", "currentColor")');
    expect(css).toContain("hsl(var(--color-bg))");
  });

  it("makes PAPER mode and live-disabled state unambiguous", () => {
    expect(html).toContain("PAPER · 실거래 비활성");
    expect(html).toContain("실거래 주문을 전송하지 않습니다.");
    expect(html).toContain("Paper 매수");
    expect(html).toContain("Paper 매도");
    expect(html).toContain("REAL/LIVE 상태를 추론하거나 활성화하지 않습니다.");
    expect(html).not.toMatch(/data-(?:simple-)?(?:live|real)-(?:order|enable|activate)/i);
  });

  it("shows only runtime-backed NUSA state and never fabricates confidence or a risk gate", () => {
    expect(html).toContain("실제 runtime이 제공하는 전략·자동화·시장 연결 상태만 표시합니다.");
    expect(html).not.toContain("신뢰도");
    expect(html).not.toContain("Risk Gate");
  });

  it("keeps the main flow result -> state -> Paper action -> history", () => {
    expect(html).toContain("자산 결과와 NUSA 운영 상태를 먼저 확인합니다.");
    expect(html).toContain("가격 → 상태 → 주문 → 기록 순서로 확인합니다.");
    expect(html).toContain('data-simple-nav="logs">전체 기록</button>');
  });

  it("keeps settings presentation-only and persists theme through the canonical runtime", () => {
    expect(html).toContain("화면과 진단 표시만 조정합니다. 실행 권한은 변경하지 않습니다.");
    expect(runtime).toContain("await api.saveSettings(value)");
    expect(runtime).toContain("applyTheme(value.theme)");
    expect(runtime).not.toMatch(/실거래\s*(활성|사용|켜기)/);
  });

  it("supports only dark and contrast themes", () => {
    expect(html).toContain('<option value="dark">Dark</option>');
    expect(html).toContain('<option value="contrast">Contrast</option>');
    expect(runtime).toContain('theme === "contrast" ? "contrast" : "dark"');
  });

  it("owns runtime subscriptions in exactly one place", () => {
    for (const eventName of ["onStatus", "onTicker", "onSnapshot", "onControl", "onChartPoint"]) expect(runtime).toContain(`api.${eventName}`);
    expect(adapter).not.toMatch(/\.on(?:Status|Ticker|Snapshot|Control|ChartPoint)\s*\(/);
    expect(adapter).toContain("NUSACanonicalAdapter");
  });

  it("renders every chart and history target without mutation-observer mirroring", () => {
    expect(runtime).toContain('const targets = $$("[data-simple-equity-chart]")');
    expect(runtime).toContain('$$("[data-simple-log-list]")');
    expect(adapter).not.toContain("MutationObserver");
  });

  it("prevents duplicate Paper order submission and explains blocked controls", () => {
    expect(runtime).toContain("orderSubmitting: false");
    expect(runtime).toContain("if (state.orderSubmitting");
    expect(runtime).toContain("button.title = reason");
    expect(runtime).toContain('confirm.setAttribute("aria-busy", String(state.orderSubmitting))');
  });

  it("fail-closes orders on disconnected, missing-price and invalid-quantity states", () => {
    expect(runtime).toContain('connectionTone !== "connected"');
    expect(runtime).toContain("NUSA 서버와 시장 데이터가 모두 연결되어야 주문할 수 있습니다.");
    expect(runtime).toContain("유효한 현재가가 없어 주문할 수 없습니다.");
    expect(runtime).toContain("0보다 큰 주문 수량을 입력하세요.");
    expect(runtime).toContain("root.dataset.state = state.loading ? \"loading\" : tone");
  });

  it("caps chart and timeline retention", () => {
    expect(runtime).toContain("state.chartPoints.length > 120");
    expect(runtime).toContain("state.logs = state.logs.slice(0, 40)");
    expect(runtime).toContain(".slice(0, 40)");
  });

  it("avoids full snapshot rerenders on each ticker", () => {
    const tickerStart = runtime.indexOf("function renderTicker");
    const tickerEnd = runtime.indexOf("function renderCharts", tickerStart);
    const tickerBody = runtime.slice(tickerStart, tickerEnd);
    expect(tickerBody).not.toContain("renderSnapshot(");
    expect(tickerBody).toContain("renderPositions(state.snapshot)");
  });

  it("cleans runtime event listeners and subscriptions on unload", () => {
    expect(runtime).toContain("const cleanup = []");
    expect(runtime).toContain("removeEventListener");
    expect(runtime).toContain("unsubscribers.forEach");
    expect(runtime).toContain("cleanup.forEach");
  });

  it("provides accessible Paper order dialog semantics and keyboard focus containment", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="order-sheet-title"');
    expect(accessibility).toContain('event.key !== "Tab"');
    expect(accessibility).toContain("event.preventDefault()");
  });

  it("keeps status and order feedback announced", () => {
    expect(html).toContain('data-simple-connection aria-live="polite"');
    expect(html).toContain('data-simple-order-message role="status" aria-live="assertive"');
    expect(html).toContain('data-simple-settings-message role="status" aria-live="polite"');
  });

  it("gives tables keyboard access and handles long financial values", () => {
    expect(html).toContain('tabindex="0" role="region" aria-label="현재 포지션 표"');
    expect(html).toContain('tabindex="0" role="region" aria-label="보유 포지션 표"');
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("font-variant-numeric:tabular-nums");
  });

  it("locks responsive, touch, overflow, focus, and reduced-motion contracts", () => {
    for (const point of ["1280px", "1100px", "720px", "420px"]) expect(css).toContain(`max-width:${point}`);
    expect(css).toContain("min-height:44px");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion:reduce");
  });

  it("provides loading, disconnected and error presentation hooks", () => {
    expect(css).toContain('[data-state="loading"] .simple-empty::before');
    expect(css).toContain('[data-state="error"] .simple-empty');
    expect(css).toContain('[data-state="disconnected"] .simple-empty');
  });
});
