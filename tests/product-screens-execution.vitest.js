// @vitest-environment jsdom
// Executes apps/desktop/renderer/product-screens.js (previously 0% in the
// unified baseline: loaded via <script> and asserted on as source text only).
// Pins the file's own documented safety claims: blocking first-run notice,
// credential-free settings, key-based folder opening, cancelless shutdown.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function load() {
  delete window.NUSAProductScreens;
  window.eval(readFileSync(path.join(root, "apps/desktop/renderer/product-screens.js"), "utf8"));
  return window.NUSAProductScreens;
}

function stubApi(overrides = {}) {
  return {
    firstRun: async () => ({ required: false }),
    acknowledgeFirstRun: async () => {},
    settings: async () => ({
      settings: { theme: "SYSTEM", logLevel: "INFO", logRetentionDays: 30, showDiagnostics: false, showNotifications: true },
    }),
    saveSettings: async (payload) => ({ settings: payload }),
    resetSettings: async () => ({ settings: { theme: "DARK", logLevel: "INFO", logRetentionDays: 7, showDiagnostics: false, showNotifications: false } }),
    about: async () => ({
      about: {
        appName: "NUSA", appVersion: "0.1.0", buildNumber: "1", commitSha: "abc",
        electronVersion: "41", nodeVersion: "24", operatingSystem: "Windows", architecture: "x64",
        environment: "test", mode: "PAPER", liveTradingDisabled: true, privateApiDisabled: true,
        credentialStorageDisabled: true, license: "MIT", copyright: "test",
        folders: [{ key: "logs", label: "로그" }],
      },
      update: { channel: "test", automaticUpdatesEnabled: false, requiresSignedArtifact: true },
    }),
    exportDiagnostics: async () => ({ fileName: "diag.zip", byteLength: 2048, manifest: { withheldFields: ["a", "b"] } }),
    openFolder: async () => {},
    snapshot: async () => ({ audit: [], alerts: [] }),
    listExecutions: async () => [],
    onShutdown: () => {},
    shutdownProgress: async () => ({ phase: "IDLE", steps: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("first-run notice execution", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    load();
  });
  it("mounts nothing when the main process says it is not required", async () => {
    const notice = window.NUSAProductScreens.createFirstRunNotice({ api: stubApi() });
    expect(await notice.mount(document.body)).toBe(false);
    expect(document.body.innerHTML).toBe("");
  });

  it("renders statements and acknowledges through the bridge", async () => {
    const api = stubApi({
      firstRun: async () => ({
        required: true,
        notice: { statements: [{ text: "paper only" }], mode: "PAPER" },
      }),
    });
    let acknowledged = false;
    const notice = window.NUSAProductScreens.createFirstRunNotice({
      api,
      onAcknowledged: () => { acknowledged = true; },
    });
    expect(await notice.mount(document.body)).toBe(true);
    expect(document.body.textContent).toContain("paper only");
    expect(document.body.textContent).toContain("시작하기 전에 확인해 주세요");
    document.querySelector(".product-card__actions button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledged).toBe(true);
    expect(document.body.innerHTML).toBe("");
  });

  it("re-enables confirmation when acknowledgement fails", async () => {
    const api = stubApi({
      firstRun: async () => ({ required: true, notice: { statements: [{ text: "x" }], mode: "PAPER" } }),
      acknowledgeFirstRun: async () => { throw new Error("ipc down"); },
    });
    const notice = window.NUSAProductScreens.createFirstRunNotice({ api });
    await notice.mount(document.body);
    const confirm = document.querySelector(".product-card__actions button");
    confirm.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirm.disabled).toBe(false);
    expect(document.querySelector(".product-error").textContent).toBe("ipc down");
    expect(document.body.innerHTML).not.toBe("");
  });
});

describe("settings panel execution", () => {
  it("contains no credential field and no trading toggle, by construction", () => {
    load();
    const panel = window.NUSAProductScreens.createSettingsPanel({ api: stubApi() });
    const html = panel.element.innerHTML;
    expect(panel.element.querySelector('input[type="password"]')).toBeNull();
    expect(html).not.toMatch(/api[-_ ]?key|secret|password|credential/i);
    expect(html).not.toMatch(/자동매매|주문하기|매수|매도|live/i);
  });

  it("saves through the bridge and reports status", async () => {
    load();
    let saved = null;
    const api = stubApi({ saveSettings: async (payload) => { saved = payload; return { settings: payload }; } });
    const panel = window.NUSAProductScreens.createSettingsPanel({ api });
    document.body.append(panel.element);
    await panel.refresh();
    panel.element.querySelector(".ui-button--primary").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).not.toBeNull();
    expect(saved.theme).toBe("SYSTEM");
    expect(document.querySelector(".product-status").textContent).toBe("저장했습니다.");
  });
});

describe("about panel execution", () => {
  it("shows the LIVE-disabled badge and opens folders by key, never by path", async () => {
    load();
    const opened = [];
    const api = stubApi({ openFolder: async (key) => { opened.push(key); } });
    const panel = window.NUSAProductScreens.createAboutPanel({ api });
    document.body.append(panel.element);
    await panel.refresh();
    expect(document.body.textContent).toContain("LIVE TRADING DISABLED");
    const folderButton = [...document.querySelectorAll("button")].find((button) => button.textContent.endsWith("열기"));
    expect(folderButton).toBeTruthy();
    folderButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened.length).toBe(1);
    expect(opened[0]).not.toMatch(/[/\\:]/);
  });
});

describe("shutdown overlay execution", () => {
  it("stays detached on IDLE and offers no cancel control", () => {
    load();
    const overlay = window.NUSAProductScreens.createShutdownOverlay({ api: stubApi() });
    overlay.render({ phase: "IDLE", steps: [] });
    expect(document.body.innerHTML).toBe("");
    overlay.render({ phase: "RUNNING", steps: [{ label: "seal", status: "RUNNING" }] });
    expect(document.body.textContent).toContain("안전하게 종료하는 중입니다");
    const buttons = [...document.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons.some((text) => /취소|강제|force|cancel/i.test(text))).toBe(false);
  });

  it("reports completion and failure states distinctly", () => {
    load();
    const overlay = window.NUSAProductScreens.createShutdownOverlay({ api: stubApi() });
    overlay.render({ phase: "COMPLETE", steps: [] });
    expect(document.body.textContent).toContain("정상적으로 종료했습니다");
    overlay.render({ phase: "FAILED", steps: [] });
    expect(document.body.textContent).toContain("종료 중 일부 단계가 실패했습니다");
    expect(document.body.textContent).toContain("증거 폴더를 지우지 마시고");
  });
});

describe("operations panel execution", () => {
  it("renders read-only counts and fails closed on bridge errors", async () => {
    load();
    const api = stubApi({
      snapshot: async () => ({ audit: [{ action: "E", actor: "S" }], alerts: [{ severity: "P0", code: "X", message: "m" }] }),
      listExecutions: async () => [{ state: "OPEN", market: "KRW-BTC", clientOrderId: "c1" }],
    });
    const panel = window.NUSAProductScreens.createOperationsPanel({ api });
    document.body.append(panel.element);
    await panel.refresh();
    expect(document.body.textContent).toContain("1 active executions");
    expect(document.body.textContent).toContain("1 audit records");
    const failing = window.NUSAProductScreens.createOperationsPanel({
      api: stubApi({ snapshot: async () => { throw new Error("store down"); } }),
    });
    document.body.innerHTML = "";
    document.body.append(failing.element);
    await failing.refresh();
    expect(document.querySelector(".product-error").textContent).toBe("store down");
  });
});
