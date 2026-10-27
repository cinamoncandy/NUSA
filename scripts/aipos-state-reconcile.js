#!/usr/bin/env node
"use strict";

/**
 * Marks AIPOS state entries whose branch already merged as COMPLETED, from GitHub facts instead of hand edits.
 *
 * Hand-written statuses went stale: on 2026-10-27, 260 `current_*` entries still read READY_FOR_REVIEW or
 * *_PENDING_* although their branch PR had merged (#2895). This applies the same rule reproducibly:
 * an entry is changed only when it is a `current_*` work entry, has a `branch`, its status is one of the
 * in-flight statuses below, and a merged PR exists for exactly that head branch. It then sets
 * `status: COMPLETED` and adds `merged_pr: <number>` as the evidence. Nothing else in the entry is touched,
 * control keys (claimed_state, verified_state, ...) are never changed, and an entry with no merged PR is left as is.
 * COMPLETED here means "the branch PR merged", not work-order acceptance or performance evidence.
 *
 * Usage: node scripts/aipos-state-reconcile.js <merged.tsv> [--write]
 *   merged.tsv: one "<head branch>\t<merged PR number>" per line (for example from the GitHub pulls API).
 *   Without --write it only prints what it would change.
 * Reads .aipos/state.yaml and, when present, .aipos/state.d/*.yaml.
 */

const { existsSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const IN_FLIGHT = /^(READY_FOR_REVIEW|IN_PROGRESS|VERIFYING|IMPLEMENTED_LOCAL[A-Z0-9_]*|CANDIDATE[A-Z0-9_]*|[A-Z0-9_]*PENDING[A-Z0-9_]*|LOCAL_VALIDATED[A-Z0-9_]*)$/;
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_]*):/;

function parseMerged(text) {
  const merged = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [branch, number] = line.split("\t");
    if (!branch || !/^[1-9][0-9]{0,6}$/.test(number ?? "")) continue;
    const value = Number(number);
    if (!merged.has(branch) || merged.get(branch) < value) merged.set(branch, value);
  }
  return merged;
}

/** Returns the new text and the list of changed keys. Pure: same input, same output. */
function reconcileText(text, merged) {
  const lines = text.split("\n");
  const changed = [];
  let start = -1;
  const flush = (end) => {
    if (start < 0) return;
    const key = TOP_LEVEL_KEY.exec(lines[start])[1];
    if (!key.startsWith("current_")) return;
    const block = lines.slice(start + 1, end);
    if (block.some((line) => /^  merged_pr:/.test(line))) return;
    const branchLine = block.find((line) => /^  branch:/.test(line));
    const statusIndex = block.findIndex((line) => /^  status:/.test(line));
    if (branchLine === undefined || statusIndex < 0) return;
    const branch = branchLine.replace(/^  branch:\s*/, "").replace(/^["']|["']$/g, "").trim();
    const status = block[statusIndex].replace(/^  status:\s*/, "").replace(/^["']|["']$/g, "").trim();
    const pr = merged.get(branch);
    if (pr === undefined || !IN_FLIGHT.test(status)) return;
    const at = start + 1 + statusIndex;
    lines.splice(at, 1, "  status: COMPLETED", `  merged_pr: ${pr}`);
    changed.push({ key, from: status, pr });
  };
  for (let index = 0; index < lines.length; index += 1) {
    if (TOP_LEVEL_KEY.test(lines[index])) {
      const before = lines.length;
      flush(index);
      index += lines.length - before;
      start = index;
    }
  }
  flush(lines.length);
  return { text: lines.join("\n"), changed };
}

function stateFiles(root) {
  const files = [join(root, ".aipos", "state.yaml")];
  const dir = join(root, ".aipos", "state.d");
  if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (name.endsWith(".yaml")) files.push(join(dir, name));
  return files;
}

function main(argv) {
  const [mergedPath, flag] = argv;
  if (!mergedPath) throw new Error("usage: aipos-state-reconcile.js <merged.tsv> [--write]");
  const merged = parseMerged(readFileSync(mergedPath, "utf8"));
  let total = 0;
  for (const file of stateFiles(process.cwd())) {
    const { text, changed } = reconcileText(readFileSync(file, "utf8"), merged);
    for (const entry of changed) console.log(`${entry.key}: ${entry.from} -> COMPLETED (merged_pr ${entry.pr})`);
    total += changed.length;
    if (flag === "--write" && changed.length > 0) writeFileSync(file, text);
  }
  console.log(`${total} entr${total === 1 ? "y" : "ies"} ${flag === "--write" ? "updated" : "would change"}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}

module.exports = { parseMerged, reconcileText, IN_FLIGHT };
