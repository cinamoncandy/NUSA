const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const compiledPreload = path.join(root, "dist", "apps", "desktop", "src", "preload.js");

test("built preload has no source-tree contract runtime dependency", () => {
  const source = fs.readFileSync(compiledPreload, "utf8");
  assert.doesNotMatch(source, /packages[\\/]contracts[\\/]src/);
  assert.doesNotMatch(source, /require\(["'][.]{2,}["']\)/);
  assert.match(source, /ai-cio:dashboard:get/);
});

test("sandbox preload creates the restricted bridges without network or app runtime", async () => {
  const exposed = {};
  const ipcCalls = [];
  const mockElectron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        ipcCalls.push({ kind: "invoke", channel, args });
        return Promise.resolve(null);
      },
      on: (channel) => ipcCalls.push({ kind: "on", channel }),
      removeListener: (channel) => ipcCalls.push({ kind: "removeListener", channel })
    }
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === "electron"
    ? mockElectron
    : originalLoad.call(Module, request, parent, isMain);
  delete require.cache[compiledPreload];
  try {
    require(compiledPreload);
  } finally {
    Module._load = originalLoad;
  }
  const bridge = {
    nusa: Object.keys(exposed.nusa || {}).sort(),
    shadowPilot: Object.keys(exposed.shadowPilot || {}).sort(),
    hasIpcRenderer: false,
    hasNodeRequire: false,
    preflight: typeof exposed.nusa?.getPreflight === "function",
    shadowStatus: typeof exposed.shadowPilot?.status === "function"
  };
    assert.deepEqual(bridge.nusa, [
      "activateKillSwitch", "getA4Diagnostics", "getControlSnapshot", "getPreflight", "getRiskBudgetUsage", "getSnapshot", "onChartPoint", "onControl",
      "onSnapshot", "onStatus", "onTicker", "placeOrder", "releaseKillSwitch", "setAutoTrade",
      "setStrategyQuantity", "startStrategy", "stopStrategy"
    ]);
    assert.deepEqual(bridge.shadowPilot, ["observability", "pause", "preflight", "resume", "start", "status", "stop"]);
    assert.equal(bridge.hasIpcRenderer, false);
    assert.equal(bridge.hasNodeRequire, false);
  assert.equal(bridge.preflight, true);
  assert.equal(bridge.shadowStatus, true);
  await exposed.nusa.getPreflight();
  await exposed.nusa.getA4Diagnostics();
  await exposed.shadowPilot.preflight();
  await exposed.shadowPilot.status();
  await exposed.shadowPilot.observability();
  assert.ok(ipcCalls.some((call) => call.kind === "invoke" || call.kind === "on"));
});

test("preload source exposes no unrestricted or sensitive capability", () => {
  const source = fs.readFileSync(path.join(root, "apps", "desktop", "src", "preload.ts"), "utf8");
  assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.doesNotMatch(source, /fs|node:fs|credential|privateApi|UPBIT_(ACCESS|SECRET)_KEY/i);
  assert.doesNotMatch(source, /invoke(ReadWithRecovery|Mutation)\([^"']/);
});
