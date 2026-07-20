import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

describe("component library contracts", () => {
  it("ships every requested primitive using semantic CSS variables", () => {
    const css = read("apps/desktop/renderer/components.css");
    for (const component of ["ui-button", "ui-card", "ui-badge", "ui-input", "ui-select", "ui-dialog", "ui-drawer", "ui-tooltip", "ui-timeline", "ui-decision-card", "ui-evidence-row", "ui-metric-card", "ui-status", "ui-skeleton", "ui-empty-state", "ui-error-state"]) {
      expect(css).toContain(`.${component}`);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("keeps component interactions outside trading domains", () => {
    const interactions = read("apps/desktop/renderer/component-library.js");
    expect(interactions).toContain("openDialog");
    expect(interactions).toContain("openDrawer");
    expect(interactions).not.toMatch(/placeOrder|PaperBroker|ControlPlane|ipcRenderer|electron/);
  });
});
