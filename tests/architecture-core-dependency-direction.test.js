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
  const root = mkdtempSync(join(tmpdir(), "nusa-core-boundary-"));
  try {
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    callback(analyzeRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function coreToAiposFindings(result) {
  return result.findings.filter((finding) => finding.rule === "CORE_TO_AIPOS_REFERENCE");
}

test("stable Core rejects runtime dependencies on AIPOS implementation", () => {
  withFixture({
    "packages/core/src/runtime.ts": 'import { AiposPlugin } from "../../aipos/src/plugin"; void AiposPlugin;\n',
    "packages/aipos/src/plugin.ts": "export class AiposPlugin {}\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(coreToAiposFindings(result).length, 1);
    assert.equal(coreToAiposFindings(result)[0].kind, "runtime");
  });
});

test("stable Core rejects type-only dependencies on AIPOS implementation", () => {
  withFixture({
    "packages/core/src/runtime.ts": 'import type { AiposState } from "../../aipos/src/types"; export type RuntimeState = AiposState;\n',
    "packages/aipos/src/types.ts": "export interface AiposState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(coreToAiposFindings(result).length, 1);
    assert.equal(coreToAiposFindings(result)[0].kind, "type");
  });
});

test("stable Core rejects dynamic imports of AIPOS implementation", () => {
  withFixture({
    "packages/core/src/runtime.ts": 'export async function loadAipos() { return import("../../aipos/src/plugin"); }\n',
    "packages/aipos/src/plugin.ts": "export class AiposPlugin {}\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(coreToAiposFindings(result).length, 1);
    assert.equal(coreToAiposFindings(result)[0].kind, "inline-import");
    assert.deepEqual(result.runtimeCycles, []);
  });
});

test("stable Core rejects TypeScript import type expressions referencing AIPOS", () => {
  withFixture({
    "packages/core/src/runtime.ts": 'export type RuntimeState = import("../../aipos/src/types").AiposState;\n',
    "packages/aipos/src/types.ts": "export interface AiposState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(coreToAiposFindings(result).length, 1);
    assert.equal(coreToAiposFindings(result)[0].kind, "inline-import");
    assert.deepEqual(result.runtimeCycles, []);
  });
});

test("TypeScript import type expressions do not create eager runtime cycles", () => {
  withFixture({
    "packages/contracts/src/a.ts": 'import { value } from "./b"; export const other = value;\n',
    "packages/contracts/src/b.ts": 'export interface B { readonly peer?: import("./a").A; } export const value = 1;\n',
    "packages/contracts/src/a-types.ts": "export interface A { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.runtimeCycles, []);
  });
});

test("AIPOS may consume stable Core plugin contracts", () => {
  withFixture({
    "packages/core/src/pluginSystem.ts": "export interface Plugin { readonly id: string; }\n",
    "packages/aipos/src/plugin.ts": 'import type { Plugin } from "../../core/src/pluginSystem"; export type AiposPluginContract = Plugin;\n'
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(coreToAiposFindings(result), []);
    assert.equal(result.findings.length, 0);
  });
});

test("current repository has no Core to AIPOS reverse dependency", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(coreToAiposFindings(result), []);
  assert.deepEqual(result.runtimeCycles, []);
});
