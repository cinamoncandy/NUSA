const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { tmpdir } = require("node:os");
const { analyzeRepository, layerOf } = require("../scripts/validate-architecture.js");

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function withFixture(files, callback) {
  const root = mkdtempSync(join(tmpdir(), "nusa-mobile-presentation-"));
  try {
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    callback(analyzeRepository(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mobileFindings(result) {
  return result.findings.filter((finding) => finding.rule === "MOBILE_PRESENTATION_SHORTCUT");
}

test("mobile TSX sources are presentation while mobile TS modules remain application/view-model", () => {
  assert.equal(layerOf("apps/mobile/App.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/aiView.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/aiViewModel.ts"), "APPLICATION");
});

test("mobile presentation allows static type-only imports from shared contracts", () => {
  withFixture({
    "apps/mobile/App.tsx": 'import type { Shared } from "../../packages/contracts/src/shared"; export type Props = Shared;\n',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation rejects runtime contract imports and implementation side effects", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { value } from "../../../packages/contracts/src/shared"; import "../../../packages/core/src/register"; export const View = value;\n',
    "packages/contracts/src/shared.ts": "export const value = 1;\n",
    "packages/core/src/register.ts": "export const registered = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 2);
    assert.equal(findings.every((finding) => finding.kind === "runtime"), true);
  });
});

test("mobile presentation rejects type-only references to implementations and other apps", () => {
  withFixture({
    "apps/mobile/src/view.tsx": [
      'import type { CoreState } from "../../../packages/core/src/runtime";',
      'import type { AiposState } from "../../../packages/aipos/src/state";',
      'import type { StoredState } from "../../../packages/storage/src/state";',
      'import type { CloudState } from "../../cloud/src/state";',
      "export type ViewState = CoreState & AiposState & StoredState & CloudState;"
    ].join("\n"),
    "packages/core/src/runtime.ts": "export interface CoreState { readonly core: string; }\n",
    "packages/aipos/src/state.ts": "export interface AiposState { readonly ai: string; }\n",
    "packages/storage/src/state.ts": "export interface StoredState { readonly stored: string; }\n",
    "apps/cloud/src/state.ts": "export interface CloudState { readonly cloud: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 4);
    assert.equal(findings.every((finding) => finding.kind === "type"), true);
  });
});

test("mobile presentation rejects require, import-equals, dynamic import, and TypeScript import() shortcuts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": [
      'const core = require("../../../packages/core/src/runtime");',
      'import storage = require("../../../packages/storage/src/state");',
      'export const load = () => import("../../../packages/contracts/src/shared");',
      'export type SharedType = import("../../../packages/contracts/src/shared").Shared;',
      "void core; void storage;"
    ].join("\n"),
    "packages/core/src/runtime.ts": "export const value = 1;\n",
    "packages/storage/src/state.ts": "export const stored = 1;\n",
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 4);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["runtime", "inline-import"]));
  });
});

test("mobile presentation may depend on mobile-local TS and TSX modules", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { LocalProjection } from "./viewModel"; import { Widget } from "./widget"; export type Props = LocalProjection; export const View = Widget;\n',
    "apps/mobile/src/viewModel.ts": 'import type { Shared } from "../../../packages/contracts/src/shared"; export type LocalProjection = Shared;\n',
    "apps/mobile/src/widget.tsx": "export const Widget = 1;\n",
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("current mobile presentation satisfies the refined boundary without unnecessary type routing", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(mobileFindings(result), []);
  const aiView = readFileSync(join(process.cwd(), "apps/mobile/src/aiView.tsx"), "utf8");
  assert.match(aiView, /import type .*packages\/contracts\/src\/aiInference/);
  assert.match(aiView, /import type .*packages\/contracts\/src\/researchAutomation/);
});
