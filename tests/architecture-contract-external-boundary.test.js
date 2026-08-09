"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
}

function externalContractImports(root) {
  const contracts = path.join(root, "packages", "contracts");
  const findings = [];
  for (const file of walk(contracts)) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    for (const specifier of importSpecifiers(fs.readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) findings.push(Object.freeze({ file: relative, specifier }));
    }
  }
  return findings;
}

function fixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-contract-external-"));
  const directory = path.join(root, "packages", "contracts", "src");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "public.ts"), source, "utf8");
  return root;
}

test("shared contracts reject node built-ins, npm packages, workspace aliases, require, and dynamic imports", () => {
  const root = fixture([
    'import { randomUUID } from "node:crypto";',
    'import type { Schema } from "external-schema";',
    'export type { Runtime } from "@nusa/core";',
    'const helper = require("external-helper");',
    'export type Dynamic = import("external-dynamic").Dynamic;',
    'void randomUUID; void helper;',
  ].join("\n"));
  try {
    assert.deepEqual(
      externalContractImports(root).map((item) => item.specifier).sort(),
      ["@nusa/core", "external-dynamic", "external-helper", "external-schema", "node:crypto"].sort()
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shared contracts still allow relative contract composition", () => {
  const root = fixture('import type { Peer } from "./peer"; export type Public = Peer;\n');
  try {
    const peer = path.join(root, "packages", "contracts", "src", "peer.ts");
    fs.writeFileSync(peer, "export interface Peer { readonly id: string; }\n", "utf8");
    assert.deepEqual(externalContractImports(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("current shared contracts have no non-relative implementation or external dependencies", () => {
  assert.deepEqual(externalContractImports(path.resolve(__dirname, "..")), []);
});
