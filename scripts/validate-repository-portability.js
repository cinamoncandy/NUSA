"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([".json", ".js", ".ts", ".md", ".yml", ".yaml", ".toml"]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "release", "coverage"]);
const violations = [];

const rules = [
  { name: "Windows user absolute path", pattern: /[A-Za-z]:\\Users\\[^\\\s"']+/g },
  { name: "Unix home absolute path", pattern: /\/(?:Users|home)\/[^/\s"']+/g },
  { name: "Codex cache path", pattern: /\.cache[\\/]codex/gi },
  { name: "reconstructed package version", pattern: /"version"\s*:\s*"[^"]*reconstructed[^"]*"/gi }
];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    const relative = path.relative(ROOT, absolute).replaceAll("\\", "/");
    const text = fs.readFileSync(absolute, "utf8");
    for (const rule of rules) {
      const matches = text.match(rule.pattern) ?? [];
      for (const match of matches) violations.push(`${relative}: ${rule.name}: ${match}`);
    }
  }
}

visit(ROOT);

if (violations.length > 0) {
  console.error("Repository portability validation failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Repository portability validation passed.");
