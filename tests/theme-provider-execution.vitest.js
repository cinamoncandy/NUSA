// @vitest-environment jsdom
// Executes apps/desktop/renderer/theme-provider.js (a classic browser script
// previously at 0% in the unified baseline because renderer tests only
// asserted on source text). Verifies the fail-closed theme contract:
// unknown/restricted input always resolves to the safe dark theme.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "apps/desktop/renderer/theme-provider.js"), "utf8");

function load() {
  delete window.NUSATheme;
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
  window.eval(source);
  return window.NUSATheme;
}

describe("theme provider execution", () => {
  beforeEach(() => {
    load();
  });

  it("exposes a frozen NUSATheme API", () => {
    expect(Object.isFrozen(window.NUSATheme)).toBe(true);
    expect(typeof window.NUSATheme.setTheme).toBe("function");
    expect(typeof window.NUSATheme.getTheme).toBe("function");
    expect(typeof window.NUSATheme.initialize).toBe("function");
  });

  it("resolves unknown themes to dark", () => {
    expect(window.NUSATheme.setTheme("neon")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.NUSATheme.getTheme()).toBe("dark");
  });

  it("applies and persists valid themes", () => {
    expect(window.NUSATheme.setTheme("contrast")).toBe("contrast");
    expect(document.documentElement.dataset.theme).toBe("contrast");
    expect(window.localStorage.getItem("nusa.theme")).toBe("contrast");
  });

  it("still applies the theme when storage is unavailable (persistence skipped, no throw)", () => {
    const failing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    Object.defineProperty(window, "localStorage", { value: failing, configurable: true });
    expect(window.NUSATheme.setTheme("contrast")).toBe("contrast");
    expect(document.documentElement.dataset.theme).toBe("contrast");
    expect(window.NUSATheme.initialize()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
