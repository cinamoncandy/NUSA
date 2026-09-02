import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("apps/desktop/renderer/index.html");
const cockpit = read("apps/desktop/renderer/cockpit.css");
const runtime = read("apps/desktop/renderer/app-runtime.js");
const architecture = read("apps/desktop/renderer/ARCHITECTURE.md");

describe("NUSA AI Trading Cockpit presentation contract", () => {
  it("keeps the canonical route count while applying the new product hierarchy", () => {
    const nav = html.match(/class="v2-nav__item[^>]*data-simple-nav="([^"]+)"/g) ?? [];
    expect(nav).toHaveLength(5);
    for (const route of ["dashboard", "orders", "positions", "strategy", "logs", "settings"]) {
      expect(html).toContain(`data-simple-page="${route}"`);
    }
    expect(html).toContain("COMMAND HOME");
    expect(html).toContain("MARKETS + ORDER STATION");
    expect(html).toContain("PORTFOLIO + RISK");
    expect(html).toContain("AI DECISION / NUSA");
    expect(html).toContain("ANALYTICS + ACTIVITY");
    expect(html).toContain("SETTINGS + AUTHORITY");
  });

  it("loads the cockpit presentation layer after the canonical baseline", () => {
    expect(html.indexOf('href="app.css"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="cockpit.css"')).toBeGreaterThan(html.indexOf('href="app.css"'));
    expect(architecture).toContain("cockpit.css");
  });

  it("keeps runtime ownership unchanged", () => {
    expect(runtime).toContain("global.NUSACanonicalUI");
    expect(runtime).toContain("api.onStatus");
    expect(runtime).toContain("api.onTicker");
    expect(html).toContain('data-runtime-owner="canonical"');
    expect(html).not.toContain("MutationObserver");
  });

  it("repeats only runtime-backed command-home truth", () => {
    for (const selector of [
      "data-simple-total-equity",
      "data-simple-pnl",
      "data-simple-held-value",
      "data-simple-position-count",
      "data-simple-market-price",
      "data-simple-market-status",
      "data-simple-auto-trade",
      "data-simple-strategy-status",
      "data-simple-updated"
    ]) expect(html).toContain(selector);
  });

  it("makes Paper and no-live semantics structural", () => {
    expect(html).toContain("PAPER · 실거래 비활성");
    expect(html).toContain("PAPER ONLY");
    expect(html).toContain("실거래 주문을 전송하지 않습니다.");
    expect(html).toContain("LIVE 주문 권한");
    expect(html).toContain("이 화면의 권한 변경");
    expect(html).not.toMatch(/data-(?:simple-)?(?:live|real)-(?:order|enable|activate)/i);
  });

  it("marks unavailable advanced evidence instead of fabricating values", () => {
    expect(html).toContain("현재 canonical runtime에서 제공되지 않습니다");
    expect(html).toContain("미제공 값을 안전·정상·0으로 표시하지 않습니다.");
    expect(html).toContain("authoritative 데이터 계약이 추가되기 전까지 표시하지 않습니다.");
    expect(html).not.toContain("Risk Gate");
    expect(html).not.toContain("신뢰도");
  });

  it("uses semantic tokens and no private literal color palette", () => {
    expect(cockpit).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(cockpit).not.toContain("--palette-");
    expect(cockpit).toContain("hsl(var(--color-bg))");
    expect(cockpit).toContain("hsl(var(--color-primary)");
  });

  it("preserves desktop density and mobile action contracts", () => {
    for (const point of ["1280px", "1100px", "720px", "420px"]) expect(cockpit).toContain(`max-width:${point}`);
    expect(cockpit).toContain("grid-template-columns: repeat(5");
    expect(cockpit).toContain("min-height: 52px");
    expect(cockpit).toContain("min-height: 56px");
    expect(cockpit).toContain("prefers-reduced-motion:reduce");
    expect(cockpit).toContain('data-simple-page="positions"');
  });
});
