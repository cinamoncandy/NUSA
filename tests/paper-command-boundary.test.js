const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("packaged Desktop PAPER execution uses Cloud canonical IPC while legacy RuntimeCommandService remains local-simulation only", () => {
  const main = read("apps/desktop/src/main.ts");
  const cloudMain = read("apps/desktop/src/cloudMain.ts");
  const runtime = read("apps/desktop/src/control/runtimeCommandService.ts");
  const preload = read("apps/desktop/src/preload.ts");
  const renderer = read("apps/desktop/renderer/renderer.js");
  // paper:order's runtime.manualOrder(...) call now lives in registerPaperIpcHandlers.ts,
  // registered from main.ts.
  const paperIpc = read("apps/desktop/src/ipc/registerPaperIpcHandlers.ts");

  // The mature legacy runtime remains available for an explicit LOCAL_SIMULATION entrypoint.
  assert.match(paperIpc, /runtime\.manualOrder\(/);
  assert.doesNotMatch(main, /broker\.execute\(/);
  assert.doesNotMatch(paperIpc, /broker\.execute\(/);
  assert.match(runtime, /requireRiskApproval\(/);
  assert.match(runtime, /broker\.execute\(/);

  // The packaged canonical entrypoint structurally removes the local PAPER command/query
  // handlers after loading the legacy runtime, so they cannot become a second writer/truth.
  assert.match(cloudMain, /activateCloudCanonicalDesktopAuthority\(\)/);
  assert.match(cloudMain, /"paper:order"/);
  assert.match(cloudMain, /"paper:snapshot"/);
  assert.match(cloudMain, /ipcMain\.removeHandler\(channel\)/);

  // Renderer-facing PAPER command/read traffic is Cloud-only. The preload cannot import a
  // broker and cannot expose the legacy local paper:order channel.
  assert.doesNotMatch(preload, /PaperBroker/);
  assert.match(preload, /invokeMutation\("cloud-paper:order"/);
  assert.match(preload, /invokeReadWithRecovery\("cloud-paper:snapshot"/);
  assert.doesNotMatch(preload, /invokeMutation\("paper:order"/);
  assert.doesNotMatch(renderer, /ipcRenderer|PaperBroker|paper:order/);
});
