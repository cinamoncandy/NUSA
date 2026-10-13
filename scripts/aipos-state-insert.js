#!/usr/bin/env node
"use strict";

/**
 * Adds one new top-level entry to .aipos/state.yaml at its name-order position instead of at the
 * top or the end of the file.
 *
 * Almost every PR adds a state entry, and sessions appended at the end or inserted right after
 * `version: 1`, so any two open PRs touched the same lines and every merge left the others in
 * conflict (71 state.yaml commits across 60 merges between 2026-10-10 and 2026-10-13). Entries with
 * different names now land at different places and merge cleanly. The file's existing order is not
 * changed; readers do not depend on it.
 *
 * Usage: node scripts/aipos-state-insert.js <entry.yaml>   (the file holds exactly one top-level key)
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const yaml = require("js-yaml");

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_]*):/;

function topLevelKeys(lines) {
  const keys = [];
  lines.forEach((line, index) => {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match) keys.push({ key: match[1], index });
  });
  return keys;
}

/** Pure: returns the new file text, or throws. */
function insertStateEntry(stateText, entryText) {
  const entry = entryText.replace(/\s+$/, "");
  const entryKeys = topLevelKeys(entry.split("\n"));
  if (entryKeys.length !== 1 || entryKeys[0].index !== 0) throw new Error("ENTRY_MUST_BE_ONE_TOP_LEVEL_KEY");
  const parsedEntry = yaml.load(entry);
  if (!parsedEntry || typeof parsedEntry !== "object" || Object.keys(parsedEntry).length !== 1) throw new Error("ENTRY_INVALID_YAML");
  const name = entryKeys[0].key;

  const lines = stateText.replace(/\n*$/, "").split("\n");
  const existing = topLevelKeys(lines);
  if (existing.some(({ key }) => key === name)) throw new Error(`ENTRY_ALREADY_EXISTS:${name}`);
  // Insert before the entry whose name comes next in name order (not the first larger name in file
  // order: the file is not sorted, so that would send most new entries to the same spot). Two new
  // names collide only when no existing entry sorts between them. `version` always stays first.
  const following = existing
    .filter(({ key }) => key !== "version" && key > name)
    .reduce((best, candidate) => (best === null || candidate.key < best.key ? candidate : best), null);
  const insertAt = following ? following.index : lines.length;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
  const result = [...before, "", ...entry.split("\n"), ...(after.length > 0 ? ["", ...after] : [])].join("\n") + "\n";

  const parsed = yaml.load(result);
  if (!parsed || typeof parsed !== "object" || !(name in parsed)) throw new Error("STATE_INVALID_AFTER_INSERT");
  return result;
}

if (require.main === module) {
  const entryPath = process.argv[2];
  if (!entryPath) {
    console.error("usage: node scripts/aipos-state-insert.js <entry.yaml>");
    process.exit(2);
  }
  const statePath = join(process.cwd(), ".aipos", "state.yaml");
  try {
    writeFileSync(statePath, insertStateEntry(readFileSync(statePath, "utf8"), readFileSync(entryPath, "utf8")));
    console.log("AIPOS_STATE_INSERT OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { insertStateEntry };
