const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { classifyChangedFiles, serverReachableMobileFiles } = require("../scripts/mobile-only-delta.js");

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mod-"));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  return root;
}
const base = {
  "apps/cloud/src/loop.ts": 'import { guard } from "../../mobile/src/guard";\n',
  "apps/mobile/src/guard.ts": 'import { helper } from "./helper";\nexport const guard = 1;\n',
  "apps/mobile/src/helper.ts": "export const helper = 1;\n",
  "apps/mobile/src/holoSphere.tsx": "export const x = 1;\n",
  "scripts/run.js": 'require("../dist/apps/mobile/src/viaDist.js");\n',
  "apps/mobile/src/viaDist.ts": "export const d = 1;\n",
};

test("pure presentation files, mobile tests, AIPOS and docs are MOBILE_ONLY", () => {
  const root = fixture(base);
  const r = classifyChangedFiles(["apps/mobile/src/holoSphere.tsx", "tests/mobile-foo.test.js", "tests/uiux-bar.test.js", ".aipos/state.yaml", "docs/UI_ARCHITECTURE.md"], root);
  assert.equal(r.status, "MOBILE_ONLY");
  assert.deepEqual(r.offending, []);
});

test("mobile files that server code imports, directly or transitively or via dist, are SERVER_AFFECTING", () => {
  const root = fixture(base);
  assert.deepEqual([...serverReachableMobileFiles(root)].sort(), ["apps/mobile/src/guard.ts", "apps/mobile/src/helper.ts", "apps/mobile/src/viaDist.ts"]);
  for (const f of ["apps/mobile/src/guard.ts", "apps/mobile/src/helper.ts", "apps/mobile/src/viaDist.ts"]) {
    const r = classifyChangedFiles(["apps/mobile/src/holoSphere.tsx", f], root);
    assert.equal(r.status, "SERVER_AFFECTING", f);
    assert.deepEqual(r.offending, [f]);
  }
});

test("anything unknown fails closed, including server code, workflows, lockfiles, traversal and an empty change set", () => {
  const root = fixture(base);
  for (const f of ["apps/cloud/src/loop.ts", ".github/workflows/ci.yml", "pnpm-lock.yaml", "package.json", "deploy/oracle/paper-markets.json", "scripts/run.js", "apps/mobile/../cloud/x.ts"]) {
    assert.equal(classifyChangedFiles([f], root).status, "SERVER_AFFECTING", f);
  }
  assert.equal(classifyChangedFiles([], root).status, "SERVER_AFFECTING");
  assert.equal(classifyChangedFiles(["", "  "], root).status, "SERVER_AFFECTING");
});

test("in the real repository the capital and withdrawal guards stay server code", () => {
  const reached = serverReachableMobileFiles(path.join(__dirname, ".."));
  assert.ok(reached.has("apps/mobile/src/capitalAllocationGuard.ts"));
  assert.ok(reached.has("apps/mobile/src/withdrawalReservation.ts"));
  assert.equal(classifyChangedFiles(["apps/mobile/src/capitalAllocationGuard.ts"], path.join(__dirname, "..")).status, "SERVER_AFFECTING");
});
