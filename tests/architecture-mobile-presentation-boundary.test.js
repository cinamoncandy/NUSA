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

test("mobile presentation allows specifier-level type-only imports from shared contracts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { type Shared } from "../../../packages/contracts/src/shared"; export type Props = Shared;\n',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation rejects runtime and side-effect imports from shared contracts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { value } from "../../../packages/contracts/src/runtime"; import "../../../packages/contracts/src/register"; export const View = value;\n',
    "packages/contracts/src/runtime.ts": "export const value = 1;\n",
    "packages/contracts/src/register.ts": "export const registered = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 2);
    assert.equal(findings.every((finding) => finding.kind === "runtime"), true);
  });
});

test("mobile presentation rejects type-only imports from implementation packages", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { CoreState } from "../../../packages/core/src/state"; export type Props = CoreState;\n',
    "packages/core/src/state.ts": "export interface CoreState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.equal(mobileFindings(result).length, 1);
    assert.equal(mobileFindings(result)[0].kind, "type");
  });
});

test("mobile presentation rejects cross-app and literal import-expression shortcuts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { CloudState } from "../../cloud/src/state"; export type RuntimeState = import("../../../packages/contracts/src/shared").Shared; export type ViewState = CloudState;\n',
    "apps/cloud/src/state.ts": "export interface CloudState { readonly id: string; }\n",
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 2);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["type", "inline-import"]));
  });
});

test("mobile presentation allows type-only contracts through workspace aliases but rejects runtime aliases", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import type { Shared } from "@nusa/contracts/src/shared"; import "@nusa/contracts/register"; export type Props = Shared;\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n",
    "packages/contracts/register.ts": "export const registered = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "runtime");
    assert.equal(findings[0].target, "packages/contracts/");
  });
});

test("mobile presentation rejects workspace aliases to implementation owners and ignores external packages", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import React from "react"; import type { CoreState } from "@nusa/core/state"; export type Props = { readonly state: CoreState; readonly react: typeof React };\n',
    "packages/core/package.json": '{"name":"@nusa/core"}',
    "packages/core/state.ts": "export interface CoreState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "type");
    assert.equal(findings[0].target, "packages/core/");
  });
});

test("mobile presentation may depend on mobile-local application/view-model modules", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { LocalProjection } from "./viewModel"; export type Props = LocalProjection;\n',
    "apps/mobile/src/viewModel.ts": 'import type { Shared } from "../../../packages/contracts/src/shared"; export type LocalProjection = Shared;\n',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("workspace aliases cannot bypass the shared-contract leaf boundary", () => {
  withFixture({
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/public.ts": 'import type { CoreState } from "@nusa/core/state"; export type PublicState = CoreState;\n',
    "packages/core/package.json": '{"name":"@nusa/core"}',
    "packages/core/state.ts": "export interface CoreState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = result.findings.filter((finding) => finding.rule === "CONTRACTS_TO_IMPLEMENTATION_REFERENCE");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "type");
    assert.equal(findings[0].target, "packages/core/");
  });
});

test("current mobile presentation has no forbidden direct implementation shortcuts", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(mobileFindings(result), []);
  const aiView = readFileSync(join(process.cwd(), "apps/mobile/src/aiView.tsx"), "utf8");
  assert.match(aiView, /import type \{ AiReadOnlyProjection \} from "\.\.\/\.\.\/\.\.\/packages\/contracts\/src\/aiInference"/);
  assert.match(aiView, /import type \{ ResearchStatusProjection \} from "\.\.\/\.\.\/\.\.\/packages\/contracts\/src\/researchAutomation"/);
});
