const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Paper execution stays behind the Composition Root command service and preload allowlist", () => {
  const main = read("apps/desktop/src/main.ts");
  const runtime = read("apps/desktop/src/runtimeCommandService.ts");
  const coreRoot = read("packages/core/src/runtimeCompositionRoot.ts");
  const desktopRoot = read("apps/desktop/src/desktopCompositionRoot.ts");
  const preload = read("apps/desktop/src/preload.ts");
  const renderer = read("apps/desktop/renderer/renderer.js");

  assert.match(main, /new DesktopCompositionRoot\(/);
  assert.match(main, /if \(desktopCompositionRoot\) throw new Error\("desktop runtime is already composed"\)/);
  assert.match(main, /paperCommandService\(\)/);
  assert.doesNotMatch(main, /new NusaRuntime\(/);
  assert.doesNotMatch(main, /runtime\.manualOrder\(/);
  assert.doesNotMatch(main, /broker\.execute\(/);
  assert.match(coreRoot, /new NusaRuntime\(/);
  assert.doesNotMatch(desktopRoot, /new NusaRuntime\(/);
  assert.match(runtime, /requireRiskApproval\(/);
  assert.match(runtime, /broker\.execute\(/);
  assert.doesNotMatch(preload, /PaperBroker/);
  assert.match(preload, /invokeMutation\("paper:order"/);
  assert.doesNotMatch(renderer, /ipcRenderer|PaperBroker|paper:order/);
});
