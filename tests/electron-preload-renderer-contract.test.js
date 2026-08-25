const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(root, "apps/desktop/renderer/renderer.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "apps/desktop/src/preload.ts"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "apps/desktop/src/main.ts"), "utf8");
const cloudMainSource = fs.readFileSync(path.join(root, "apps/desktop/src/cloudMain.ts"), "utf8");
const cloudPaperIpcSource = fs.readFileSync(path.join(root, "apps/desktop/src/cloud/desktopCloudPaperIpc.ts"), "utf8");
// The ipcMain.handle(...) registrations that used to live inline in main.ts now live in these
// per-domain files, registered from main.ts via registerXxxIpcHandlers(runtimeContext).
const ipcHandlerModuleSources = [
  "registerPaperIpcHandlers.ts", "registerAiIpcHandlers.ts", "registerControlIpcHandlers.ts",
  "registerSafetyIpcHandlers.ts", "registerShadowIpcHandlers.ts", "registerRecoveryIpcHandlers.ts",
  "registerAppIpcHandlers.ts", "registerDiagnosticsIpcHandlers.ts"
].map((name) => fs.readFileSync(path.join(root, "apps/desktop/src/ipc", name), "utf8"));
const contractsSource = fs.readFileSync(path.join(root, "packages/contracts/src/aiCioDashboard.ts"), "utf8");
const compiledPreloadPath = path.join(root, "dist/apps/desktop/src/preload.js");
const cloudCanonicalDisabledLegacyChannels = new Set(["paper:order", "paper:snapshot", "control:start", "control:quantity"]);

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
  const pattern = /window\.(nusa|aiCioDashboard|shadowPilot|operations)\.(\w+)/g;
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
  // Keep every known fixed prefix explicit. `cloud-paper:` is the canonical Desktop PAPER
  // client boundary; omitting it would make this contract test reject the real safe channel
  // and, worse, skip validating it against its dedicated main-process owner.
  const pattern = /"((?:cloud-paper|paper|control|market|chart|shadow|diagnostics|recovery|app|operations|execution|ai|safety):[\w-]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]);
  const [, aiCioChannel] = contractsSource.match(/AI_CIO_DASHBOARD_CHANNEL\s*=\s*"([^"]+)"/) ?? [];
  if (aiCioChannel) channels.add(aiCioChannel);
  return channels;
}

function extractMainChannels(...sources) {
  const handled = new Set();
  const sent = new Set();
  for (const source of sources) {
    let match;
    const handlePattern = /ipcMain\.handle\("([\w:-]+)"/g;
    while ((match = handlePattern.exec(source)) !== null) handled.add(match[1]);
    const sendPattern = /webContents\.send\("([\w:-]+)"/g;
    while ((match = sendPattern.exec(source)) !== null) sent.add(match[1]);
  }
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
  assert.ok(rendererUsage.get("nusa")?.size > 0, "expected renderer.js to reference window.nusa at least once");
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

test("preload never lets a caller-supplied value choose the IPC channel", async () => {
  const { exposed, ipcCalls } = loadPreloadWithElectronMock();
  const allowedChannels = extractPreloadChannels(preloadSource);
  assert.ok(allowedChannels.size > 0, "expected to extract at least one literal channel from preload.ts");

  const sentinel = "__SENTINEL_CHANNEL__";
  const unsubscribe = [];
  try {
    // Await request/response calls so timeout cleanup is part of the test lifecycle. Keep
    // subscriptions in a finally block so any assertion failure can never strand the Cloud
    // PAPER polling timer and hang the isolated coverage runner.
    await exposed.nusa.placeOrder(sentinel, sentinel);
    await exposed.nusa.getSnapshot();
    await exposed.nusa.getControlSnapshot();
    await exposed.nusa.startStrategy();
    await exposed.nusa.stopStrategy();
    await exposed.nusa.setAutoTrade(sentinel);
    await exposed.nusa.setStrategyQuantity(sentinel);
    unsubscribe.push(exposed.nusa.onTicker(() => {}));
    unsubscribe.push(exposed.nusa.onStatus(() => {}));
    unsubscribe.push(exposed.nusa.onSnapshot(() => {}));
    unsubscribe.push(exposed.nusa.onControl(() => {}));
    unsubscribe.push(exposed.nusa.onChartPoint(() => {}));
    await exposed.aiCioDashboard.getAiCioDashboard();
    await exposed.shadowPilot.preflight();
    await exposed.operations.snapshot();
    await exposed.operations.listExecutions();
    await exposed.operations.getExecution("execution-id");
    await exposed.operations.listTransitions("execution-id");
    await exposed.operations.listFills("execution-id");
    await exposed.operations.getExecutionHealth();

    assert.ok(ipcCalls.length > 0, "expected preload methods to actually reach ipcRenderer during this fuzz pass");
    for (const call of ipcCalls) {
      assert.notEqual(call.channel, sentinel, `an exposed method forwarded a caller-supplied value directly as the IPC channel: ${JSON.stringify(call)}`);
      assert.ok(
        allowedChannels.has(call.channel),
        `channel "${call.channel}" is not in preload.ts's own fixed literal channel set: ${[...allowedChannels].join(", ")}`
      );
    }
  } finally {
    for (const stop of unsubscribe) if (typeof stop === "function") stop();
  }
});

test("subscription unsubscribe functions actually remove the registered listener", () => {
  const { exposed, removedListeners } = loadPreloadWithElectronMock();
  const handler = () => {};
  const unsubscribe = exposed.nusa.onControl(handler);
  unsubscribe();
  assert.ok(
    removedListeners.some((entry) => entry.channel === "control:snapshot"),
    "calling the unsubscribe function returned by onControl() should call ipcRenderer.removeListener on the control:snapshot channel"
  );
});

test("Cloud canonical entrypoint structurally removes legacy local PAPER mutation/query IPC", () => {
  assert.match(cloudMainSource, /activateCloudCanonicalDesktopAuthority\(\)/);
  assert.match(cloudMainSource, /ipcMain\.removeHandler\(channel\)/);
  for (const channel of cloudCanonicalDisabledLegacyChannels) {
    assert.ok(cloudMainSource.includes(`"${channel}"`), `Cloud canonical entrypoint must remove legacy local IPC "${channel}"`);
  }
});

test("main process IPC owners and preload channels are the same fixed canonical contract", () => {
  const { handled, sent } = extractMainChannels(mainSource, cloudPaperIpcSource, ...ipcHandlerModuleSources);
  const preloadChannels = extractPreloadChannels(preloadSource);

  // ai-cio:dashboard:get is registered by registerAiCioReadOnlyIpc (apps/desktop/src/ai/aiCioIpcBridge.ts),
  // not by a literal ipcMain.handle(...) call in either source inspected here -- already covered
  // by tests/ai-cio-ipc-bridge.test.js, so it is excluded from this literal-string comparison.
  const requestResponseChannels = [...preloadChannels].filter((channel) => channel !== "ai-cio:dashboard:get");

  for (const channel of requestResponseChannels) {
    // Push channels: main webContents.send()s them, so there is no ipcMain.handle to find.
    if (channel === "market:ticker" || channel === "market:status" || channel === "chart:point" || channel === "app:shutdown") continue;
    assert.ok(handled.has(channel), `preload invokes "${channel}", but no main-process IPC owner handles it`);
  }
  for (const channel of handled) {
    // cloud-paper:status is intentionally main-process-only bootstrap/status plumbing and is
    // not exposed to the renderer API. Legacy local PAPER/start/quantity handlers are also
    // intentionally absent from the packaged canonical surface: cloudMain removes them after
    // the legacy module is evaluated, while direct main.ts LOCAL_SIMULATION remains available
    // only to an explicit development entrypoint.
    if (channel === "cloud-paper:status" || cloudCanonicalDisabledLegacyChannels.has(channel)) continue;
    assert.ok(preloadChannels.has(channel), `main process handles "${channel}", but preload.ts never invokes it -- dead IPC channel`);
  }

  for (const channel of cloudCanonicalDisabledLegacyChannels) {
    assert.equal(preloadChannels.has(channel), false, `canonical preload must never expose legacy local IPC "${channel}"`);
  }

  for (const channel of ["market:ticker", "market:status", "chart:point", "paper:snapshot", "control:snapshot", "app:shutdown"]) {
    assert.ok(sent.has(channel), `main process must continue emitting the governed push channel "${channel}"`);
  }
});
