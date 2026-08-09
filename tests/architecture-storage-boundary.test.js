const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { tmpdir } = require("node:os");
const { analyzeRepository } = require("../scripts/validate-architecture.js");

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function storageRuntimeAppFindings(result) {
  return result.findings.filter((finding) => finding.rule === "STORAGE_RUNTIME_APP_REFERENCE");
}

test("storage rejects runtime dependencies on application implementations", () => {
  const root = mkdtempSync(join(tmpdir(), "nusa-storage-boundary-"));
  try {
    write(root, "packages/storage/src/store.ts", 'import { runtimeValue } from "../../../apps/cloud/src/runtime"; export const value = runtimeValue;\n');
    write(root, "apps/cloud/src/runtime.ts", "export const runtimeValue = 1;\n");
    const result = analyzeRepository(root);
    assert.deepEqual(result.unresolved, []);
    assert.equal(storageRuntimeAppFindings(result).length, 1);
    assert.equal(storageRuntimeAppFindings(result)[0].kind, "runtime");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("current repository has no storage runtime dependency on apps", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(storageRuntimeAppFindings(result), []);
});
