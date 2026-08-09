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
  const root = mkdtempSync(join(tmpdir(), "nusa-contract-leaf-"));
  try {
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    callback(analyzeRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function contractFindings(result) {
  return result.findings.filter((finding) => finding.rule === "CONTRACTS_TO_IMPLEMENTATION_REFERENCE");
}

test("shared contracts reject runtime dependencies on Core implementation", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import { runtimeValue } from "../../core/src/runtime"; export const value = runtimeValue;\n',
    "packages/core/src/runtime.ts": "export const runtimeValue = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "runtime");
  });
});

test("shared contracts reject side-effect runtime imports of implementation modules", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import "../../core/src/register"; export interface PublicContract { readonly id: string; }\n',
    "packages/core/src/register.ts": "globalThis.__nusaContractLeak = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "runtime");
  });
});

test("shared contracts reject comment-obfuscated side-effect imports", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import/* red-team */"../../core/src/register"; export interface PublicContract { readonly id: string; }\n',
    "packages/core/src/register.ts": "globalThis.__nusaContractLeak = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "runtime");
  });
});

test("shared contracts reject comment-obfuscated bound imports and require calls", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import/* red-team */{ runtimeValue } from "../../core/src/runtime"; const other = require/* red-team */("../../aipos/src/plugin"); export const value = runtimeValue + other.runtimeValue;\n',
    "packages/core/src/runtime.ts": "export const runtimeValue = 1;\n",
    "packages/aipos/src/plugin.ts": "export const runtimeValue = 2;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 2);
    assert.ok(contractFindings(result).every((finding) => finding.kind === "runtime"));
  });
});

test("shared contracts reject type-only dependencies on AIPOS implementation", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import type { AiposState } from "../../aipos/src/types"; export type PublicState = AiposState;\n',
    "packages/aipos/src/types.ts": "export interface AiposState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "type");
  });
});

test("shared contracts reject specifier-level type-only dependencies on implementation", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'import { type AiposState } from "../../aipos/src/types"; export type PublicState = AiposState;\n',
    "packages/aipos/src/types.ts": "export interface AiposState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "type");
  });
});

test("shared contracts reject literal import expressions that escape the package", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'export type RuntimeState = import("../../core/src/runtime").RuntimeState;\n',
    "packages/core/src/runtime.ts": "export interface RuntimeState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 1);
    assert.equal(contractFindings(result)[0].kind, "type");
    assert.deepEqual(result.runtimeCycles, []);
  });
});

test("shared contracts reject comment-obfuscated dynamic and type import expressions", () => {
  withFixture({
    "packages/contracts/src/public.ts": 'export type RuntimeState = import/* red-team */("../../core/src/runtime").RuntimeState; export async function load() { return import/* red-team */("../../aipos/src/plugin"); }\n',
    "packages/core/src/runtime.ts": "export interface RuntimeState { readonly id: string; }\n",
    "packages/aipos/src/plugin.ts": "export const runtimeValue = 2;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(contractFindings(result).length, 2);
    assert.deepEqual(new Set(contractFindings(result).map((finding) => finding.kind)), new Set(["type", "runtime"]));
  });
});

test("shared contracts reject workspace package-name aliases to implementation owners", () => {
  withFixture({
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/public.ts": 'import type { CloudState } from "@nusa/cloud/state"; export async function load() { return import("@nusa/cloud/runtime"); } export type PublicState = CloudState;\n',
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/state.ts": "export interface CloudState { readonly id: string; }\n",
    "apps/cloud/runtime.ts": "export const runtimeValue = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = contractFindings(result);
    assert.equal(findings.length, 2);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["type", "runtime"]));
    assert.equal(findings.every((finding) => finding.target === "apps/cloud/"), true);
  });
});

test("shared contracts may compose other shared contracts", () => {
  withFixture({
    "packages/contracts/src/a.ts": 'import type { SharedB } from "./b"; export interface SharedA { readonly b: SharedB; }\n',
    "packages/contracts/src/b.ts": "export interface SharedB { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(contractFindings(result), []);
  });
});

test("implementations may consume shared contracts", () => {
  withFixture({
    "packages/contracts/src/public.ts": "export interface SharedContract { readonly id: string; }\n",
    "packages/core/src/runtime.ts": 'import type { SharedContract } from "../../contracts/src/public"; export type RuntimeContract = SharedContract;\n',
    "packages/aipos/src/plugin.ts": 'import type { SharedContract } from "../../contracts/src/public"; export type PluginContract = SharedContract;\n'
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(contractFindings(result), []);
  });
});

test("current repository keeps shared contracts implementation-free", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(contractFindings(result), []);
  assert.deepEqual(result.runtimeCycles, []);
});
