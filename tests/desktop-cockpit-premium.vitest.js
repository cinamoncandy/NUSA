import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const premium = read("apps/desktop/renderer/cockpit-premium.css");
const adapter = read("apps/desktop/renderer/app-adapter.js");

describe("NUSA premium cockpit presentation", () => {
  it("mounts the premium layer exactly once through the zero-authority adapter", () => {
    expect(adapter).toContain('cockpit-premium.css');
    expect(adapter).toContain('data-nusa-cockpit-premium');
    expect(adapter).toContain('querySelector');
    expect(adapter).toContain('presentationLayer: "cockpit-premium"');
  });

  it("does not acquire runtime subscription or trading authority", () => {
    expect(adapter).not.toMatch(/\.on(?:Status|Ticker|Snapshot|Control|ChartPoint)\s*\(/);
    expect(adapter).not.toMatch(/placeOrder|strategyCommand|saveSettings|enableLive|credential|productionMutationAllowed/i);
    expect(adapter).not.toContain("MutationObserver");
  });

  it("uses tokenized control-room colors with no private literal palette", () => {
    expect(premium).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(premium).not.toMatch(/rgba?\(/i);
    expect(premium).toContain("var(--cr-ink-950)");
    expect(premium).toContain("var(--cr-teal-400)");
    expect(premium).toContain("var(--cr-amber-300)");
    expect(premium).toContain("var(--cr-red-500)");
  });

  it("prioritizes institutional density over decorative dashboard spacing", () => {
    expect(premium).toContain("min-height: 60px");
    expect(premium).toContain("min-height: 96px");
    expect(premium).toContain("min-height: 38px");
    expect(premium).toContain("font-variant-numeric: tabular-nums slashed-zero");
    expect(premium).toContain("border-radius: var(--radius-sm)");
  });

  it("preserves large mobile order targets and visible keyboard focus", () => {
    expect(premium).toContain("min-height: 56px");
    expect(premium).toContain(":focus-visible");
    expect(premium).toContain("outline: 2px solid var(--cr-teal-300)");
    expect(premium).toContain("prefers-reduced-motion:reduce");
  });
});
