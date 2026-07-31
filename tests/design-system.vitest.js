import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

describe("NUSA design system", () => {
  it("defines the approved spacing scale and accessibility themes", () => {
    const tokens = read("apps/desktop/renderer/tokens.css");
    for (const scale of [4, 8, 12, 16, 24, 32, 48, 64, 80, 96]) {
      expect(tokens).toContain(`--space-${scale}:`);
    }
    expect(tokens).toContain(':root[data-theme="contrast"]');
    expect(tokens).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps future component tooling on the shared token contract", () => {
    expect(read("tailwind.config.cjs")).toContain("var(--primary)");
    expect(JSON.parse(read("components.json")).tailwind.css).toBe("apps/desktop/renderer/tokens.css");
  });
});
