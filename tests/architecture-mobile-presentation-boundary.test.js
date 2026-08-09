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
  const root = mkdtempSync(join(tmpdir(), "nusa-mobile-presentation-"));
  try {
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    callback(analyzeRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mobileFindings(result) {
  return result.findings.filter((finding) => finding.rule === "MOBILE_PRESENTATION_SHORTCUT");
}

test("mobile UI rejects runtime imports from Core implementation", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { runtimeValue } from "../../../packages/core/src/runtime"; export const value = runtimeValue;\n',
    "packages/core/src/runtime.ts": "export const runtimeValue = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
    assert.equal(mobileFindings(result)[0].kind, "runtime");
  });
});

test("mobile UI rejects type-only imports from AIPOS implementation", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { AiposState } from "../../../packages/aipos/src/types"; export type ViewState = AiposState;\n',
    "packages/aipos/src/types.ts": "export interface AiposState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
    assert.equal(mobileFindings(result)[0].kind, "type");
  });
});

test("mobile UI rejects require shortcuts to Storage implementation", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'const storage = require("../../../packages/storage/src/store"); export const value = storage.value;\n',
    "packages/storage/src/store.ts": "export const value = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
    assert.equal(mobileFindings(result)[0].kind, "runtime");
  });
});

test("mobile UI rejects literal import expressions that escape the mobile app", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'export type RuntimeState = import("../../../packages/core/src/runtime").RuntimeState;\n',
    "packages/core/src/runtime.ts": "export interface RuntimeState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
    assert.equal(mobileFindings(result)[0].kind, "inline-import");
  });
});

test("mobile UI rejects cross-app implementation imports", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { desktopValue } from "../../desktop/main/runtime"; export const value = desktopValue;\n',
    "apps/desktop/main/runtime.ts": "export const desktopValue = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
  });
});

test("mobile UI may consume mobile-local application and view-model modules", () => {
  withFixture({
    "apps/mobile/App.tsx": 'import { buildViewModel } from "./src/viewModel"; export const value = buildViewModel();\n',
    "apps/mobile/src/view.tsx": 'import type { ViewModel } from "./viewModel"; export type Props = { readonly model: ViewModel };\n',
    "apps/mobile/src/viewModel.ts": "export interface ViewModel { readonly id: string; } export function buildViewModel() { return { id: 'ok' }; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("current repository mobile UI has no package or cross-app shortcut", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(mobileFindings(result), []);
  assert.deepEqual(result.runtimeCycles, []);
});
