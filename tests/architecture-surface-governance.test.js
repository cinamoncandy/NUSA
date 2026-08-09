const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { validateArchitectureSurfaces } = require("../scripts/validate-architecture-surfaces.js");

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nusa-arch-surfaces-"));
  const surface = {
    id: "desktop-main-ipc",
    kind: "ELECTRON_IPC_MAIN",
    path: "apps/desktop/src/main.ts",
    marker: "ipcMain.handle(",
    access: "LOCAL_PROCESS",
    authority: "PAPER_LOCAL_CONTROL",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    credentialExecutionAllowed: false
  };
  write(root, surface.path, "ipcMain.handle(\"paper:test\", () => null);\n");
  write(root, "config/architecture/surfaces.json", JSON.stringify({
    version: 1,
    invariants: { liveAuthority: "NONE", productionMutationAllowed: false, credentialExecutionAllowed: false },
    surfaces: [surface]
  }, null, 2));
  return root;
}

test("architecture surface governance accepts a fully registered boundary owner", () => {
  const root = fixture();
  try {
    const result = validateArchitectureSurfaces(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
    assert.deepEqual(result.discovered, ["apps/desktop/src/main.ts"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("architecture surface governance rejects a newly introduced unregistered owner", () => {
  const root = fixture();
  try {
    write(root, "apps/cloud/src/newServer.ts", "const http = require(\"node:http\"); http.createServer(() => {});\n");
    const result = validateArchitectureSurfaces(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("ARCH_SURFACE_UNREGISTERED_OWNER:apps/cloud/src/newServer.ts"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("architecture surface governance rejects authority expansion", () => {
  const root = fixture();
  try {
    const path = join(root, "config/architecture/surfaces.json");
    const manifest = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    manifest.surfaces[0].productionMutationAllowed = true;
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    const result = validateArchitectureSurfaces(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("ARCH_SURFACE_PRODUCTION_MUTATION_DRIFT:apps/desktop/src/main.ts"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("current repository architecture surfaces are fully registered", () => {
  const result = validateArchitectureSurfaces(process.cwd());
  assert.equal(result.ok, true, result.failures.join("\n"));
});
