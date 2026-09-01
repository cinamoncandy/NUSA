import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const html = read("apps/desktop/renderer/index-v2.html");
const css = read("apps/desktop/renderer/v2.css");
const rendererPath = read("apps/desktop/src/rendererPath.ts");

const legacyPresentationAssets = [
  "simple-ui.css",
  "brand-ui.css",
  "workspace.css",
  "control-room.css",
  "product-screens.css",
  "application-state.css",
  "styles.css"
];

const canonicalRoutes = ["dashboard", "orders", "positions", "strategy", "logs"];

describe("NUSA UI/UX V2 canonical renderer", () => {
  it("uses the dedicated v2 renderer entry", () => {
    expect(rendererPath).toContain('index-v2.html');
    expect(html).toContain('id="simple-ui-root"');
    expect(html).toContain('class="v2-app"');
  });

  it("loads only the canonical visual layers", () => {
    expect(html).toContain('href="tokens.css"');
    expect(html).toContain('href="components.css"');
    expect(html).toContain('href="v2.css"');
    for (const asset of legacyPresentationAssets) expect(html).not.toContain(`href="${asset}"`);
  });

  it("exposes exactly the five primary product destinations", () => {
    const primaryNav = html.match(/class="v2-nav__item[^>]*data-simple-nav="([^"]+)"/g) ?? [];
    expect(primaryNav).toHaveLength(5);
    for (const route of canonicalRoutes) expect(html).toContain(`class="v2-nav__item${route === "dashboard" ? " is-active" : ""}" data-simple-nav="${route}"`);
  });

  it("keeps settings outside the five primary navigation items", () => {
    expect(html).toContain('class="v2-settings"');
    expect(html).toContain('data-simple-nav="settings"');
  });

  it("does not create a second token system or reach into palette tokens", () => {
    expect(css).not.toMatch(/--simple-[\w-]+\s*:/);
    expect(css).not.toContain("--palette-");
    expect(css).toContain("hsl(var(--color-bg))");
    expect(css).toContain("hsl(var(--color-surface))");
  });

  it("preserves Paper-only order language in the active UI", () => {
    expect(html).toContain("PAPER");
    expect(html).toContain("Paper 매수");
    expect(html).toContain("Paper 매도");
    expect(html).toContain("실거래 권한은 없습니다");
  });

  it("loads the compatibility adapter after the existing paper UI binder", () => {
    const binder = html.indexOf('src="simple-ui.js"');
    const adapter = html.indexOf('src="v2-adapter.js"');
    expect(binder).toBeGreaterThan(-1);
    expect(adapter).toBeGreaterThan(binder);
  });
});
