#!/usr/bin/env node
"use strict";

/**
 * Cloudflare removal S3a: the path rule of docs/CLOUDFLARE_REMOVAL_S2_DESIGN_2026-11-19.md section 3.1.
 *
 * Reads the changed-file list of a PR (the JSON of `gh api --paginate --slurp repos/.../pulls/N/files`, a list of pages or a
 * flat list) and prints exactly one line:
 *   RELEASE_CONTROL_PATH_RULE result=PROTECTED path=<first protected path>
 *   RELEASE_CONTROL_PATH_RULE result=CLEAR files=<count>
 * A PR that touches a protected path is never auto-merged (the audit workflow ends with NO_ACTION); the owner merges it by hand.
 * Fail closed: unreadable or malformed input, a file entry without a string name, or a list that may be truncated (the API
 * returns at most 3000 files) exits 2 and prints nothing else, which fails the audit job. No network, no writes.
 */

const fs = require("node:fs");

const PROTECTED_PATHS = Object.freeze([
  "config/release-control.json",
  "scripts/release-control-check.js",
  "scripts/release-control-path-rule.js",
  ".github/workflows/autopilot-deterministic-audit-release.yml",
  ".github/CODEOWNERS",
  "CODEOWNERS"
]);
const API_FILE_LIMIT = 3000;

const normalize = (name) => String(name).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");

function flatten(parsed) {
  if (!Array.isArray(parsed)) throw new Error("not a list");
  return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

function evaluate(parsed) {
  const files = flatten(parsed);
  if (files.length >= API_FILE_LIMIT) throw new Error("file list may be truncated");
  const protectedSet = new Set(PROTECTED_PATHS);
  for (const file of files) {
    if (file == null || typeof file !== "object" || typeof file.filename !== "string" || file.filename === "") throw new Error("file entry without a name");
    if (file.previous_filename != null && typeof file.previous_filename !== "string") throw new Error("invalid previous_filename");
    for (const candidate of [file.filename, file.previous_filename]) {
      if (typeof candidate === "string" && candidate !== "" && protectedSet.has(normalize(candidate))) return { result: "PROTECTED", path: normalize(candidate) };
    }
  }
  return { result: "CLEAR", files: files.length };
}

function main(argv) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(argv[2], "utf8"));
    const outcome = evaluate(parsed);
    process.stdout.write(outcome.result === "PROTECTED" ? `RELEASE_CONTROL_PATH_RULE result=PROTECTED path=${outcome.path}\n` : `RELEASE_CONTROL_PATH_RULE result=CLEAR files=${outcome.files}\n`);
    return 0;
  } catch {
    process.stderr.write("RELEASE_CONTROL_PATH_RULE result=ERROR (fail closed)\n");
    return 2;
  }
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { evaluate, PROTECTED_PATHS, API_FILE_LIMIT };
