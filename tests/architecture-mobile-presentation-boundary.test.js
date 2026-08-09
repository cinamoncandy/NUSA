const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
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
    callback(analyzeRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mobileFindings(result) {
  return result.findings.filter((finding) => finding.rule === "MOBILE_PRESENTATION_SHORTCUT");
}

function mobileInlineEdges(result) {
  return result.edges.filter((edge) => edge.source === "apps/mobile/src/view.tsx" && edge.inline === true);
}

test("mobile TSX is presentation while mobile TS remains application", () => {
  assert.equal(layerOf("apps/mobile/App.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/view.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/viewModel.ts"), "APPLICATION");
});

test("mobile presentation allows static type-only shared contracts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { Shared } from "../../../packages/contracts/src/shared"; export type Props = Shared;\n',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation allows static type-only shared contracts through workspace alias", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import type { Shared } from "@nusa/contracts/src/shared"; export type Props = Shared;\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation rejects runtime contracts and implementation package shortcuts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { sharedValue } from "../../../packages/contracts/src/shared"; import type { CoreState } from "../../../packages/core/src/runtime"; const storage = require("../../../packages/storage/src/store"); export const value = sharedValue + storage.value; export type State = CoreState;\n',
    "packages/contracts/src/shared.ts": "export const sharedValue = 1;\n",
    "packages/core/src/runtime.ts": "export interface CoreState { readonly id: string; }\n",
    "packages/storage/src/store.ts": "export const value = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 3);
    assert.deepEqual(new Set(findings.map((finding) => finding.target)), new Set(["packages/contracts/src/shared.ts", "packages/core/src/runtime.ts", "packages/storage/src/store.ts"]));
  });
});

test("mobile presentation rejects runtime contracts through workspace alias", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import/* red-team */"@nusa/contracts/register"; export const View = null;\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/register.ts": "export const registered = true;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "runtime");
    assert.equal(findings[0].target, "packages/contracts/");
  });
});

test("mobile presentation rejects import expressions to contracts and cross-app workspace aliases", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'export type Shared = import("@nusa/contracts/src/shared").Shared; import type { CloudState } from "@nusa/cloud/state"; export type Props = CloudState;\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n",
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/state.ts": "export interface CloudState { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 2);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["type"]));
    const inline = mobileInlineEdges(result);
    assert.equal(inline.length, 1);
    assert.equal(inline[0].kind, "type");
    assert.equal(inline[0].target, "packages/contracts/");
    assert.equal(result.edges.some((edge) => edge.source === "apps/mobile/src/view.tsx" && edge.target === "apps/cloud/" && edge.kind === "type" && edge.inline !== true), true);
  });
});

test("mobile presentation may use local modules and external npm packages", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import React from "react"; import type { ViewModel } from "./viewModel"; export type Props = { readonly model: ViewModel; readonly react: typeof React };\n',
    "apps/mobile/src/viewModel.ts": "export interface ViewModel { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("current repository mobile presentation has no forbidden shortcuts", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(mobileFindings(result), []);
  assert.deepEqual(result.runtimeCycles, []);
});
