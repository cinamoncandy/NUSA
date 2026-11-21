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
    '<button data-simple-settings-save>save</button>' +
    '<button data-simple-settings-reset>reset</button>' +
    '<div data-simple-settings-message></div>' +
    '<input data-simple-setting="theme" value="SYSTEM" />' +
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
  delete window.nusaApp;
  delete window.confirm;
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

  it("resets settings only after confirmation", async () => {
    mount();
    let resetCalls = 0;
    window.nusaApp = {
      resetSettings: async () => { resetCalls += 1; },
      settings: async () => ({ settings: { theme: "DARK" } }),
    };
    const message = () => document.querySelector("[data-simple-settings-message]").textContent;
    window.confirm = () => false;
    document.querySelector("[data-simple-settings-reset]").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(resetCalls).toBe(0);
    window.confirm = () => true;
    document.querySelector("[data-simple-settings-reset]").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(resetCalls).toBe(1);
    expect(message().length).toBeGreaterThan(0);
    delete window.confirm;
  });

  it("reports unavailable save bridge without throwing", async () => {
    mount();
    expect(window.nusaApp).toBeUndefined();
    document.querySelector("[data-simple-settings-save]").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[data-simple-settings-message]").textContent.length).toBeGreaterThan(0);
  });
});

describe("unknown control state (UI diagnosis finding 1)", () => {
  const controlFixture = () => {
    fixture();
    const root = document.querySelector("#simple-ui-root");
    root.insertAdjacentHTML("beforeend",
      '<small data-simple-updated>업데이트 대기 중</small>' +
      '<strong data-simple-strategy-status>확인 중</strong><b data-simple-auto-trade>확인 중</b>' +
      '<button data-simple-strategy="start">start</button><button data-simple-strategy="stop">stop</button>');
  };
  const read = (selector) => document.querySelector(selector).textContent;
  // mount() deletes window.nusa first, so a bridge stub has to be installed after those deletes.
  const mountWithBridge = (bridge) => {
    delete window.NUSACanonicalUI; delete window.nusa; delete window.nusaApp; delete window.NUSAMobileViewModel;
    window.nusa = bridge;
    vi.useFakeTimers();
    window.eval(source);
    return window.NUSACanonicalUI;
  };
  afterEach(() => { delete window.nusa; });

  beforeEach(() => { controlFixture(); });

  it("with no bridge the state stays unknown, both PAPER buttons are disabled and no update time is shown", async () => {
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(read("[data-simple-strategy-status]")).not.toBe("중지됨");
    expect(read("[data-simple-auto-trade]")).not.toBe("꺼짐");
    expect(read("[data-simple-updated]")).toBe("아직 데이터를 받지 못했습니다");
    expect(document.querySelector("[data-simple-strategy='start']").disabled).toBe(true);
    expect(document.querySelector("[data-simple-strategy='stop']").disabled).toBe(true);
  });

  it("a failed or empty first control read says it cannot be confirmed instead of waiting forever", async () => {
    mountWithBridge({ getSnapshot: async () => null, getControlSnapshot: async () => null });
    await vi.advanceTimersByTimeAsync(0);
    expect(read("[data-simple-strategy-status]")).toBe("확인 불가");
    expect(read("[data-simple-auto-trade]")).toBe("확인 불가");
    expect(document.querySelector("[data-simple-strategy='start']").disabled).toBe(true);
    expect(document.querySelector("[data-simple-strategy='stop']").disabled).toBe(true);
  });

  it("a real control answer replaces the unknown state and enables the matching PAPER button only", async () => {
    mountWithBridge({ getSnapshot: async () => null, getControlSnapshot: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(read("[data-simple-strategy-status]")).toBe("중지됨");
    expect(read("[data-simple-auto-trade]")).toBe("꺼짐");
    expect(document.querySelector("[data-simple-strategy='start']").disabled).toBe(false);
    expect(document.querySelector("[data-simple-strategy='stop']").disabled).toBe(true);
  });

  it("a later control push recovers from a failed first read", async () => {
    let push = null;
    mountWithBridge({ getSnapshot: async () => null, getControlSnapshot: async () => null, onControl: (callback) => { push = callback; return () => undefined; } });
    await vi.advanceTimersByTimeAsync(0);
    expect(read("[data-simple-strategy-status]")).toBe("확인 불가");
    push({ status: "RUNNING", autoTradeEnabled: true, events: [] });
    expect(read("[data-simple-strategy-status]")).toBe("실행 중");
    expect(read("[data-simple-auto-trade]")).toBe("켜짐");
    expect(document.querySelector("[data-simple-strategy='start']").disabled).toBe(true);
    expect(document.querySelector("[data-simple-strategy='stop']").disabled).toBe(false);
  });
});

describe("PAPER strategy start and stop ask first (UI diagnosis finding on one-click control)", () => {
  const mountControl = (bridge) => {
    fixture();
    document.querySelector("#simple-ui-root").insertAdjacentHTML("beforeend", '<p data-simple-last-signal></p><button data-simple-strategy="start">start</button><button data-simple-strategy="stop">stop</button>');
    delete window.NUSACanonicalUI; delete window.nusa; delete window.nusaApp; delete window.NUSAMobileViewModel;
    window.nusa = bridge;
    vi.useFakeTimers();
    window.eval(source);
  };
  afterEach(() => { delete window.nusa; });
  const calls = { start: 0, stop: 0 };
  const bridge = () => ({ getSnapshot: async () => null, getControlSnapshot: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
    startStrategy: async () => { calls.start += 1; return { status: "RUNNING", autoTradeEnabled: true, events: [] }; },
    stopStrategy: async () => { calls.stop += 1; return { status: "STOPPED", autoTradeEnabled: false, events: [] }; } });
  beforeEach(() => { calls.start = 0; calls.stop = 0; });

  it("declining the question sends nothing; accepting sends exactly one PAPER command", async () => {
    mountControl(bridge());
    await vi.advanceTimersByTimeAsync(0);
    const asked = [];
    window.confirm = (question) => { asked.push(question); return false; };
    document.querySelector("[data-simple-strategy='start']").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.start).toBe(0);
    expect(asked[0]).toContain("모의(PAPER)");
    expect(asked[0]).toContain("실제 주문은 발생하지 않습니다");
    expect(document.querySelector("[data-simple-last-signal]").textContent).toBe("요청을 취소했습니다.");
    window.confirm = () => true;
    document.querySelector("[data-simple-strategy='start']").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.start).toBe(1);
    expect(calls.stop).toBe(0);
  });

  it("without a confirm function nothing is sent (fail closed)", async () => {
    mountControl(bridge());
    await vi.advanceTimersByTimeAsync(0);
    delete window.confirm;
    window.confirm = undefined;
    document.querySelector("[data-simple-strategy='start']").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.start).toBe(0);
  });
});
