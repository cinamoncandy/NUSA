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

function withFixture(files, callback) {
  const root = mkdtempSync(join(tmpdir(), "nusa-workspace-alias-boundary-"));
  try {
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    callback(analyzeRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rules(result, source) {
  return new Set(result.findings.filter((item) => item.source === source).map((item) => item.rule));
}

test("storage runtime require cannot bypass app boundary through a workspace package alias", () => {
  withFixture({
    "packages/storage/package.json": '{"name":"@nusa/storage"}',
    "packages/storage/src/adapter.ts": 'const cloud = require("@nusa/cloud/runtime"); export const value = cloud.value;\n',
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.equal(rules(result, "packages/storage/src/adapter.ts").has("STORAGE_RUNTIME_APP_REFERENCE"), true);
  });
});

test("execution import-equals cannot bypass cross-layer boundary through a workspace package alias", () => {
  withFixture({
    "apps/execution/package.json": '{"name":"@nusa/execution"}',
    "apps/execution/runtime.ts": 'import cloud = require("@nusa/cloud/runtime"); export const value = cloud.value;\n',
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.equal(rules(result, "apps/execution/runtime.ts").has("EXECUTION_CROSS_LAYER_REFERENCE"), true);
  });
});

test("dynamic workspace import participates in the same storage runtime boundary rules", () => {
  withFixture({
    "packages/storage/package.json": '{"name":"@nusa/storage"}',
    "packages/storage/src/lazy.ts": 'export async function load() { return import("@nusa/cloud/runtime"); }\n',
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.equal(rules(result, "packages/storage/src/lazy.ts").has("STORAGE_RUNTIME_APP_REFERENCE"), true);
  });
});

test("TypeScript import-type workspace alias preserves type semantics while enforcing execution boundary", () => {
  withFixture({
    "apps/execution/package.json": '{"name":"@nusa/execution"}',
    "apps/execution/types.ts": 'export type Stored = import("@nusa/storage/types").Stored;\n',
    "packages/storage/package.json": '{"name":"@nusa/storage"}',
    "packages/storage/types.ts": "export interface Stored { readonly id: string; }\n"
  }, (result) => {
    const findings = result.findings.filter((item) => item.source === "apps/execution/types.ts");
    assert.equal(findings.some((item) => item.rule === "EXECUTION_CROSS_LAYER_REFERENCE" && item.kind === "type"), true);
    assert.equal(findings.some((item) => item.rule === "DOMAIN_TO_INFRASTRUCTURE" && item.kind === "type"), true);
  });
});
