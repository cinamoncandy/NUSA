// @vitest-environment jsdom
// Integration execution for apps/desktop/renderer/renderer.js (996 lines,
// previously 0% in the unified baseline): loads control-room,
// command-palette, and product-screens first, then mounts the composing
// renderer over a generated DOM fixture. Catches load-time reference errors
// and verifies the composed surfaces initialize.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const IDS = [
  "a4-diagnostics-verdict", "a4-diagnostics-grid", "run-a4-diagnostics", "a4-diagnostics-error",
  "recovery-review-verdict", "recovery-review-grid", "approve-recovery-review", "complete-recovery",
  "recovery-review-error", "run-recovery-reconcile", "cio-portfolio", "control-room", "equity", "cash",
  "position", "average", "unrealized", "realized", "orders", "strategy-status", "strategy-id",
  "auto-trade", "strategy-quantity", "strategy-start", "strategy-stop", "events", "chart",
  "focus-mode", "focus-mode-label", "focus-hint", "status", "price", "change", "error", "quantity",
  "buy", "sell", "kill-switch-release", "kill-switch-message", "kill-switch-reason", "kill-switch-confirm",
  "kill-switch-activate", "ai-explain-signal", "ai-explain-output", "ai-followup", "ai-followup-answer",
  "ai-followup-ask", "ai-followup-question", "ai-challenger", "ai-explain-disagreement",
  "ai-challenger-champion", "ai-challenger-ai", "ai-challenger-agreement", "ai-challenger-reason",
  "ai-disagreement-output", "ai-challenger-agreement-rate", "ai-challenger-history-toggle",
  "ai-challenger-history-table", "ai-challenger-history-body", "ai-summarize-session", "ai-summary-output",
  "ai-explain-regime", "ai-regime-output", "ai-explain-risk", "ai-risk-output", "cio-status", "cio-warnings",
  "cio-freshness", "cio-system", "cio-opportunity", "cio-strategy", "cio-committee", "cio-execution",
  "cio-risk", "cio-risk-reasons", "cio-research",
  "risk-budget-grid", "refresh-risk-budget", "product-overlays", "product-settings", "product-about", "evidence",
  "command-palette", "command-palette-search", "command-palette-list", "command-palette-empty",
  "command-palette-status", "command-palette-trigger", "command-palette-close", "operations-detail",
];

function fixture() {
  document.body.innerHTML = "";
  for (const id of IDS) {
    const node = document.createElement(id === "chart" ? "canvas" : "div");
    node.id = id;
    if (id === "control-room" || id === "command-palette") node.hidden = false;
    document.body.append(node);
  }
  const start = document.getElementById("strategy-start");
  start.replaceWith(Object.assign(document.createElement("button"), { id: "strategy-start" }));
  const stop = document.getElementById("strategy-stop");
  stop.replaceWith(Object.assign(document.createElement("button"), { id: "strategy-stop" }));
  const auto = document.getElementById("auto-trade");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "auto-trade";
  auto.replaceWith(checkbox);
  const quantity = document.getElementById("quantity");
  const qty = document.createElement("input");
  qty.id = "quantity";
  quantity.replaceWith(qty);
  const palette = document.getElementById("command-palette");
  palette.hidden = true;
  const search = document.getElementById("command-palette-search");
  const searchInput = document.createElement("input");
  searchInput.id = "command-palette-search";
  search.replaceWith(searchInput);
  const altClose = document.createElement("button");
  altClose.setAttribute("data-command-palette-close", "");
  palette.append(altClose);
}

function polyfills() {
  if (typeof window.Element.prototype.scrollIntoView !== "function") {
    window.Element.prototype.scrollIntoView = function () {};
  }
  if (typeof window.scrollTo !== "function") window.scrollTo = function () {};
  if (typeof window.HTMLCanvasElement !== "undefined" && !window.HTMLCanvasElement.prototype.__nusaStubbed) {
    window.HTMLCanvasElement.prototype.__nusaStubbed = true;
    window.HTMLCanvasElement.prototype.getContext = function () {
      return {
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        set lineWidth(_) {}, set strokeStyle(_) {},
      };
    };
  }
}

function mount() {
  for (const key of ["NUSAControlRoom", "NUSACommandPalette", "NUSAProductScreens"]) delete window[key];
  delete window.shadowPilot;
  const handlers = {};
  const subscribe = (name) => (callback) => { handlers[name] = callback; return () => { delete handlers[name]; }; };
  window.nusa = {
    onStatus: subscribe("status"),
    onTicker: subscribe("ticker"),
    onSnapshot: subscribe("snapshot"),
    onControl: subscribe("control"),
    onChartPoint: subscribe("chartPoint"),
    getSnapshot: async () => null,
    getControlSnapshot: async () => null,
    getRiskBudgetUsage: async () => ({
      symbolExposure: 0.1, portfolioExposure: 0.2, dailyBuyNotional: 0, dailySellNotional: 0,
      openOrders: 0, ordersPerSecond: 0, ordersPerMinute: 0, sameSideStreak: 0,
      dailyLoss: 0, consecutiveLosses: 0, sessionDrawdown: 0,
    }),
  };
  polyfills();
  vi.useFakeTimers();
  window.eval(read("apps/desktop/renderer/control-room.js"));
  window.eval(read("apps/desktop/renderer/command-palette.js"));
  window.eval(read("apps/desktop/renderer/product-screens.js"));
  window.eval(read("apps/desktop/renderer/renderer.js"));
  return handlers;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("renderer integration mount", () => {
  let handlers;
  beforeEach(() => {
    fixture();
    handlers = mount();
  });

  it("mounts all four scripts without throwing", () => {
    expect(window.NUSAControlRoom).toBeTruthy();
    expect(window.NUSACommandPalette).toBeTruthy();
    expect(window.NUSAProductScreens).toBeTruthy();
  });

  it("streams bridge status and ticker into the dashboard", () => {
    expect(typeof handlers.status).toBe("function");
    expect(typeof handlers.ticker).toBe("function");
    handlers.status("connected");
    expect(document.getElementById("status").textContent).toBe("Upbit 연결됨");
    handlers.ticker({ trade_price: 150000000, signed_change_rate: 0.0123 });
    expect(document.getElementById("price").textContent).toContain("150,000,000");
    expect(document.getElementById("change").textContent).toBe("1.23%");
  });

  it("mounts the control-room banner into its root", () => {
    expect(document.getElementById("control-room").textContent).toContain("꺼짐");
  });

  it("registers palette commands from live button state", () => {
    document.getElementById("command-palette").hidden = true;
    const search = document.getElementById("command-palette-search");
    search.value = "focus";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(document.getElementById("command-palette-status").textContent).toContain("개 명령");
  });

  it("exposes product screen factories", () => {
    const factories = window.NUSAProductScreens;
    for (const key of ["createFirstRunNotice", "createSettingsPanel", "createAboutPanel", "createOperationsPanel", "createShutdownOverlay"]) {
      expect(typeof factories[key]).toBe("function");
    }
  });
});
