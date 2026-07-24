"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOTS = ["apps", "packages"];
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "release", "coverage"]);
const violations = [];

const rules = [
  { name: "unchecked 'as any' type assertion", pattern: /\bas\s+any\b/g },
  { name: "TypeScript error/check suppression comment", pattern: /@ts-(?:ignore|expect-error|nocheck)\b/g },
  { name: "lint suppression comment", pattern: /eslint-disable/g }
];

function isTypeScriptSource(relative) {
  return relative.endsWith(".ts") && !relative.endsWith(".d.ts") && relative.includes(`${path.sep}src${path.sep}`);
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    const relative = path.relative(ROOT, absolute);
    if (!isTypeScriptSource(relative)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const rule of rules) {
      const matches = text.match(rule.pattern) ?? [];
      for (const match of matches) violations.push(`${relative.replaceAll("\\", "/")}: ${rule.name}: ${match}`);
    }
  }
}

for (const sourceRoot of SOURCE_ROOTS) {
  const absoluteRoot = path.join(ROOT, sourceRoot);
  if (fs.existsSync(absoluteRoot)) visit(absoluteRoot);
}

if (violations.length > 0) {
  console.error("Type-safety audit failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  console.error(
    "\nasserting 'as any', @ts-ignore/@ts-expect-error/@ts-nocheck, and eslint-disable each silence a real " +
    "safety check rather than fix the underlying issue. Fix the code, narrow the type, or get an explicit " +
    "owner-reviewed exception before reintroducing one of these."
  );
  process.exit(1);
}

console.log("Type-safety audit passed: no unchecked type assertions or suppressed checks in apps/*/src or packages/*/src.");
