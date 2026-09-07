// @vitest-environment jsdom
// Executes renderer interaction scripts previously at 0% in the unified
// baseline (loaded via <script> tags and asserted on as source text only):
// component-library.js (dialog/drawer), app-accessibility.js (focus trap,
// busy-state sync), and app-adapter.js (version seam).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function resetDom() {
  document.body.innerHTML = "";
  delete window.NUSAComponents;
  delete window.NUSACanonicalAdapter;
}

describe("component library execution", () => {
  beforeEach(() => {
    resetDom();
    window.eval(read("apps/desktop/renderer/component-library.js"));
  });

  it("rejects unknown or non-dialog targets without throwing", () => {
    expect(window.NUSAComponents.openDialog("missing")).toBe(false);
    expect(window.NUSAComponents.closeDialog("missing")).toBe(false);
    document.body.innerHTML = '<div id="plain"></div>';
    expect(window.NUSAComponents.openDialog("plain")).toBe(false);
  });

  it("opens and closes drawers with aria state", () => {
    document.body.innerHTML = '<div id="d1" class="ui-drawer" hidden><button data-drawer-close>X</button></div>';
    expect(window.NUSAComponents.openDrawer("missing")).toBe(false);
    expect(window.NUSAComponents.openDrawer("d1")).toBe(true);
    const drawer = document.getElementById("d1");
    expect(drawer.hidden).toBe(false);
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(window.NUSAComponents.closeDrawer("d1")).toBe(true);
    expect(drawer.hidden).toBe(true);
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
  });

  it("closes visible drawers on Escape", () => {
    document.body.innerHTML = '<div id="d1" class="ui-drawer"><button>X</button></div>';
    document.getElementById("d1").hidden = false;
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("d1").hidden).toBe(true);
  });

  it("delegates data-attribute clicks to drawers", () => {
    document.body.innerHTML = '<button id="opener" data-drawer-open="d1">open</button><div id="d1" class="ui-drawer" hidden></div>';
    document.getElementById("opener").click();
    expect(document.getElementById("d1").hidden).toBe(false);
  });
});

describe("accessibility execution", () => {
  beforeEach(() => {
    resetDom();
    document.body.innerHTML =
      '<div id="simple-ui-root"><div data-simple-sheet>' +
      '<button id="confirm" data-simple-sheet-confirm>confirm</button>' +
      '<button id="cancel">cancel</button>' +
      "</div></div>";
    window.eval(read("apps/desktop/renderer/app-accessibility.js"));
  });

  it("traps Tab focus inside the visible sheet", () => {
    const confirm = document.getElementById("confirm");
    const cancel = document.getElementById("cancel");
    cancel.focus();
    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(confirm);
  });

  it("ignores non-Tab keys", () => {
    const cancel = document.getElementById("cancel");
    cancel.focus();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.activeElement).toBe(cancel);
  });
});

describe("canonical adapter seam", () => {
  it("exposes a frozen version marker", () => {
    resetDom();
    window.eval(read("apps/desktop/renderer/app-adapter.js"));
    expect(Object.isFrozen(window.NUSACanonicalAdapter)).toBe(true);
    expect(window.NUSACanonicalAdapter.version).toBe(1);
  });
});
