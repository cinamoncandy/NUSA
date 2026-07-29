const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(root, "apps/desktop/renderer/renderer.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "apps/desktop/src/preload.ts"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "apps/desktop/src/main.ts"), "utf8");
const contractsSource = fs.readFileSync(path.join(root, "packages/contracts/src/aiCioDashboard.ts"), "utf8");
const compiledPreloadPath = path.join(root, "dist/apps/desktop/src/preload.js");

// A: security webPreferences (contextIsolation/nodeIntegration/sandbox) are already asserted
// verbatim by tests/release-production-hardening.test.js -- not duplicated here. This test
// only adds the one thing that isn't covered there: that the preload path wiring itself
// (same-directory reference, unchanged since WO-0003 explicitly left it alone) still holds.
test("BrowserWindow still points webPreferences.preload at the compiled preload script", () => {
  assert.match(mainSource, /preload:\s*path\.join\(__dirname,\s*"preload\.js"\)/);
});

/** Every `window.<namespace>.<method>(` reference in the real renderer.js source -- not a
 * hardcoded guess, so this test breaks (loudly) if renderer.js starts using a method this
 * file doesn't know about, instead of silently passing. */
function extractRendererUsage(source) {
  const usage = new Map(); // namespace -> Set<method>
  const pattern = /window\.(dokkaebi|aiCioDashboard|shadowPilot)\.(\w+)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, namespace, method] = match;
    if (!usage.has(namespace)) usage.set(namespace, new Set());
    usage.get(namespace).add(method);
  }
  return usage;
}

/** The fixed, literal IPC channel strings preload.ts actually uses -- extracted from source,
 * not retyped from memory, so this list can't silently drift from the real contract. */
function extractPreloadChannels(source) {
  const channels = new Set();
  // `app:` added for the WO-0034-A4O productization channels. Widening the extractor is
  // coverage, not relaxation: a prefix it does not know is a channel it silently ignores.
  const pattern = /"((?:paper|control|market|chart|shadow|diagnostics|recovery|app):[\w-]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]);
  const [, aiCioChannel] = contractsSource.match(/AI_CIO_DASHBOARD_CHANNEL\s*=\s*"([^"]+)"/) ?? [];
  if (aiCioChannel) channels.add(aiCioChannel);
  return channels;
}

function extractMainChannels(source) {
  const handled = new Set();
  const sent = new Set();
  let match;
  const handlePattern = /ipcMain\.handle\("([\w:-]+)"/g;
  while ((match = handlePattern.exec(source)) !== null) handled.add(match[1]);
  const sendPattern = /webContents\.send\("([\w:-]+)"/g;
  while ((match = sendPattern.exec(source)) !== null) sent.add(match[1]);
  return { handled, sent };
}

/** Loads the *compiled* preload.js with a mocked `electron` module (Module._load
 * interception -- no mocking library added; this is ~10 lines of node:module, and Electron
 * itself cannot be installed in this sandbox at all) and captures exactly what
 * contextBridge.exposeInMainWorld() was actually called with, plus every ipcRenderer
 * call any exposed method makes when invoked for real. */
function loadPreloadWithElectronMock() {
  const exposed = {};
  const ipcCalls = [];
  const listeners = new Map();
  const removedListeners = [];

  const mockElectron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => { exposed[name] = api; }
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        ipcCalls.push({ kind: "invoke", channel, args });
        return Promise.resolve(null);
      },
      on: (channel, listener) => {
        ipcCalls.push({ kind: "on", channel });
        listeners.set(channel, listener);
      },
      removeListener: (channel, listener) => {
        ipcCalls.push({ kind: "removeListener", channel });
        removedListeners.push({ channel, listener });
      }
    }
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return mockElectron;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[compiledPreloadPath];
  try {
    require(compiledPreloadPath);
  } finally {
    Module._load = originalLoad;
  }

  return { exposed, ipcCalls, listeners, removedListeners };
}

test("preload exposes exactly the globals/methods renderer.js actually calls", () => {
  const rendererUsage = extractRendererUsage(rendererSource);
  assert.ok(rendererUsage.get("dokkaebi")?.size > 0, "expected renderer.js to reference window.dokkaebi at least once");
  assert.ok(rendererUsage.get("aiCioDashboard")?.size > 0, "expected renderer.js to reference window.aiCioDashboard at least once");

  const { exposed } = loadPreloadWithElectronMock();

  for (const [namespace, methods] of rendererUsage) {
    assert.ok(exposed[namespace], `renderer.js uses window.${namespace}, but preload never exposed it`);
    for (const method of methods) {
      assert.equal(
        typeof exposed[namespace][method],
        "function",
        `renderer.js calls window.${namespace}.${method}(), but preload's exposed "${namespace}" has no such function`
      );
    }
  }
});

test("preload never lets a caller-supplied value choose the IPC channel", () => {
  const { exposed, ipcCalls } = loadPreloadWithElectronMock();
  const allowedChannels = extractPreloadChannels(preloadSource);
  assert.ok(allowedChannels.size > 0, "expected to extract at least one literal channel from preload.ts");

  const sentinel = "__SENTINEL_CHANNEL__";
  // Fuzz every exposed method with the sentinel wherever an argument slot exists -- if any
  // method forwarded a caller argument straight through as the ipcRenderer channel (the
  // `invoke(channel, payload)` / `send(channel, payload)` shape this check exists to catch),
  // it would show up verbatim in ipcCalls below.
  void exposed.dokkaebi.placeOrder(sentinel, sentinel);
  void exposed.dokkaebi.getSnapshot();
  void exposed.dokkaebi.getControlSnapshot();
  void exposed.dokkaebi.startStrategy();
  void exposed.dokkaebi.stopStrategy();
  void exposed.dokkaebi.setAutoTrade(sentinel);
  void exposed.dokkaebi.setStrategyQuantity(sentinel);
  const unsubscribeTicker = exposed.dokkaebi.onTicker(() => {});
  const unsubscribeStatus = exposed.dokkaebi.onStatus(() => {});
  const unsubscribeSnapshot = exposed.dokkaebi.onSnapshot(() => {});
  const unsubscribeControl = exposed.dokkaebi.onControl(() => {});
  const unsubscribeChart = exposed.dokkaebi.onChartPoint(() => {});
  void exposed.aiCioDashboard.getAiCioDashboard();
  void exposed.shadowPilot.preflight();

  assert.ok(ipcCalls.length > 0, "expected preload methods to actually reach ipcRenderer during this fuzz pass");
  for (const call of ipcCalls) {
    assert.notEqual(call.channel, sentinel, `an exposed method forwarded a caller-supplied value directly as the IPC channel: ${JSON.stringify(call)}`);
    assert.ok(
      allowedChannels.has(call.channel),
      `channel "${call.channel}" is not in preload.ts's own fixed literal channel set: ${[...allowedChannels].join(", ")}`
    );
  }

  for (const unsubscribe of [unsubscribeTicker, unsubscribeStatus, unsubscribeSnapshot, unsubscribeControl, unsubscribeChart]) {
    assert.equal(typeof unsubscribe, "function", "onX subscription methods must return an unsubscribe function");
  }
});

test("subscription unsubscribe functions actually remove the registered listener", () => {
  const { exposed, removedListeners } = loadPreloadWithElectronMock();
  const handler = () => {};
  const unsubscribe = exposed.dokkaebi.onControl(handler);
  unsubscribe();
  assert.ok(
    removedListeners.some((entry) => entry.channel === "control:snapshot"),
    "calling the unsubscribe function returned by onControl() should call ipcRenderer.removeListener on the control:snapshot channel"
  );
});

test("main process ipcMain/webContents channels and preload's channels are the same set (no one-sided contract)", () => {
  const { handled, sent } = extractMainChannels(mainSource);
  const preloadChannels = extractPreloadChannels(preloadSource);

  // ai-cio:dashboard:get is registered by registerAiCioReadOnlyIpc (apps/desktop/src/aiCioIpcBridge.ts),
  // not by a literal ipcMain.handle(...) call in main.ts -- already covered by
  // tests/ai-cio-ipc-bridge.test.js, so it's excluded from this literal-string comparison.
  const requestResponseChannels = [...preloadChannels].filter((channel) => channel !== "ai-cio:dashboard:get");

  for (const channel of requestResponseChannels) {
    // Push channels: main webContents.send()s them, so there is no ipcMain.handle to find.
    // `app:shutdown` joins them (WO-0034-A4O) and is asserted as a send below.
    if (channel === "market:ticker" || channel === "market:status" || channel === "chart:point" || channel === "app:shutdown") continue;
    assert.ok(handled.has(channel), `preload invokes "${channel}", but main.ts has no ipcMain.handle("${channel}", ...)`);
  }
  for (const channel of handled) {
    assert.ok(preloadChannels.has(channel), `main.ts handles "${channel}", but preload.ts never invokes it -- dead IPC channel`);
  }

  for (const channel of ["market:ticker", "market:status", "chart:point", "paper:snapshot", "control:snapshot", "app:shutdown"]) {
    assert.ok(sent.has(channel), `preload subscribes to "${channel}", but main.ts never webContents.send()s it`);
  }
});
