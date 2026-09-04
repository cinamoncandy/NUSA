// @vitest-environment jsdom
// Executes apps/desktop/renderer/app-runtime.js (331 lines, previously 0% in
// the unified baseline: loaded via <script> and asserted on as source text
// only). Mounts with a fixture DOM and no bridge (fail-closed paths), using
// fake timers for the 2s staleness watchdog.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "apps/desktop/renderer/app-runtime.js"), "utf8");

function fixture() {
  document.body.innerHTML =
    '<div id="simple-ui-root" data-state="loading">' +
    '<button data-simple-nav="dashboard">d</button>' +
    '<button data-simple-nav="orders">o</button>' +
    '<section data-simple-page="dashboard">dash</section>' +
    '<section data-simple-page="orders" hidden>ord</section>' +
    '<div data-simple-connection><span class="simple-status-dot"></span></div>' +
    '<div id="simple-page-content" tabindex="-1"></div>' +
    "</div>";
}

function mount() {
  delete window.NUSACanonicalUI;
  delete window.nusa;
  delete window.nusaApp;
  delete window.NUSAMobileViewModel;
  vi.useFakeTimers();
  window.eval(source);
  return window.NUSACanonicalUI;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("app runtime mount", () => {
  beforeEach(() => {
    fixture();
  });

  it("mounts without a bridge and exposes a frozen UI handle", () => {
    const ui = mount();
    expect(Object.isFrozen(ui)).toBe(true);
    expect(typeof ui.showPage).toBe("function");
    expect(ui.state.page).toBe("dashboard");
    expect(ui.state.orderSubmitting).toBe(false);
  });

  it("routes aliases and toggles pages with aria state", () => {
    const ui = mount();
    ui.showPage("market");
    expect(ui.state.page).toBe("orders");
    const orders = document.querySelector('[data-simple-page="orders"]');
    const dashboard = document.querySelector('[data-simple-page="dashboard"]');
    expect(orders.hidden).toBe(false);
    expect(dashboard.hidden).toBe(true);
    expect(orders.classList.contains("is-active")).toBe(true);
    const activeNav = document.querySelector('[data-simple-nav="orders"]');
    expect(activeNav.getAttribute("aria-current")).toBe("page");
    ui.showPage("bogus-route");
    expect(ui.state.page).toBe("dashboard");
  });

  it("navigates on nav-button clicks", () => {
    const ui = mount();
    document.querySelector('[data-simple-nav="orders"]').click();
    expect(ui.state.page).toBe("orders");
  });

  it("marks server snapshots stale after silence", async () => {
    const ui = mount();
    ui.state.serverConnectionCode = "connected";
    ui.state.serverLastSuccessAt = Date.now();
    await vi.advanceTimersByTimeAsync(8000);
    expect(ui.state.serverConnectionCode).toBe("disconnected");
    expect(ui.state.logs.some((log) => log.message.includes("stale"))).toBe(true);
  });

  it("ignores Escape when no order sheet is pending", () => {
    const ui = mount();
    expect(ui.state.pendingOrder).toBeNull();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ui.state.pendingOrder).toBeNull();
  });
});
