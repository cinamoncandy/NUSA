"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeRepository } = require("../scripts/validate-architecture.js");

function write(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

function withFixture(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-inline-boundary-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) write(root, relativePath, content);
    callback(analyzeRepository(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("storage relative dynamic import cannot bypass runtime app boundary", () => {
  withFixture({
    "packages/storage/lazy.ts": 'export async function load() { return import("../../apps/cloud/runtime"); }\n',
    "apps/cloud/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    const findings = result.findings.filter((item) => item.source === "packages/storage/lazy.ts");
    assert.equal(findings.some((item) => item.rule === "STORAGE_RUNTIME_APP_REFERENCE" && item.kind === "runtime"), true);
  });
});

test("execution relative TypeScript import type cannot bypass storage layer boundary", () => {
  withFixture({
    "apps/execution/types.ts": 'export type Stored = import("../../packages/storage/types").Stored;\n',
    "packages/storage/types.ts": "export interface Stored { readonly id: string; }\n"
  }, (result) => {
    const findings = result.findings.filter((item) => item.source === "apps/execution/types.ts");
    assert.equal(findings.some((item) => item.rule === "EXECUTION_CROSS_LAYER_REFERENCE" && item.kind === "type"), true);
    assert.equal(findings.some((item) => item.rule === "DOMAIN_TO_INFRASTRUCTURE" && item.kind === "type"), true);
  });
});
