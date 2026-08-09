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

test("mobile TSX is presentation while mobile TS remains application/view-model", () => {
  assert.equal(layerOf("apps/mobile/App.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/aiView.tsx"), "PRESENTATION");
  assert.equal(layerOf("apps/mobile/src/aiViewModel.ts"), "APPLICATION");
});

test("mobile presentation allows mobile-local modules and static type-only Contracts imports", () => {
  withFixture({
    "apps/mobile/App.tsx": 'import { value } from "./src/viewModel"; import type { Shared } from "../../packages/contracts/src/shared"; export const View = value; export type Props = Shared;\n',
    "apps/mobile/src/viewModel.ts": "export const value = 1;\n",
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation allows workspace-alias static type-only Contracts imports and ignores external packages", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import React from "react"; import type { Shared } from "@nusa/contracts/src/shared"; export type Props = { readonly shared: Shared; readonly react: typeof React };\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(mobileFindings(result), []);
  });
});

test("mobile presentation rejects runtime Contracts and all Core/AIPOS/Storage references", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import { contractValue } from "../../../packages/contracts/src/runtime"; import type { CoreState } from "../../../packages/core/src/state"; import "../../../packages/aipos/src/register"; const storage = require("../../../packages/storage/src/runtime"); export const View = contractValue + storage.value; export type Props = CoreState;\n',
    "packages/contracts/src/runtime.ts": "export const contractValue = 1;\n",
    "packages/core/src/state.ts": "export interface CoreState { readonly id: string; }\n",
    "packages/aipos/src/register.ts": "export const registered = true;\n",
    "packages/storage/src/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 4);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["runtime", "type"]));
  });
});

test("mobile presentation rejects cross-app and inline import-expression shortcuts including Contracts", () => {
  withFixture({
    "apps/mobile/src/view.tsx": 'import type { CloudState } from "../../cloud/src/state"; export type ContractState = import("../../../packages/contracts/src/shared").Shared; export async function load() { return import("../../../packages/core/src/runtime"); } export type ViewState = CloudState;\n',
    "apps/cloud/src/state.ts": "export interface CloudState { readonly id: string; }\n",
    "packages/contracts/src/shared.ts": "export interface Shared { readonly id: string; }\n",
    "packages/core/src/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 3);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["type", "inline-import"]));
  });
});

test("mobile presentation rejects workspace aliases to runtime Contracts, implementation packages, and other apps", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'import "@nusa/contracts/register"; import type { CoreState } from "@nusa/core/state"; import type { CloudState } from "@nusa/cloud/state"; export type Props = CoreState & CloudState;\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/register.ts": "export const registered = true;\n",
    "packages/core/package.json": '{"name":"@nusa/core"}',
    "packages/core/state.ts": "export interface CoreState { readonly core: true; }\n",
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/state.ts": "export interface CloudState { readonly cloud: true; }\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 3);
    assert.deepEqual(new Set(findings.map((finding) => finding.kind)), new Set(["runtime", "type"]));
  });
});

test("workspace-alias inline import expressions remain forbidden even for Contracts", () => {
  withFixture({
    "apps/mobile/package.json": '{"name":"@nusa/mobile"}',
    "apps/mobile/src/view.tsx": 'export type Shared = import("@nusa/contracts/shared").Shared; export async function load() { return import("@nusa/cloud/runtime"); }\n',
    "packages/contracts/package.json": '{"name":"@nusa/contracts"}',
    "packages/contracts/shared.ts": "export interface Shared { readonly id: string; }\n",
    "apps/cloud/package.json": '{"name":"@nusa/cloud"}',
    "apps/cloud/runtime.ts": "export const value = 1;\n"
  }, (result) => {
    assert.deepEqual(result.unresolved, []);
    const findings = mobileFindings(result);
    assert.equal(findings.length, 2);
    assert.equal(findings.every((finding) => finding.kind === "inline-import"), true);
  });
});

test("current repository satisfies the refined mobile presentation boundary", () => {
  const result = analyzeRepository(process.cwd());
  assert.deepEqual(mobileFindings(result), []);
  assert.deepEqual(result.runtimeCycles, []);
});
