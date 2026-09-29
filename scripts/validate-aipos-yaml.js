#!/usr/bin/env node
"use strict";

/**
 * Every AIPOS YAML file must be parseable YAML with no duplicate mapping keys.
 *
 * AIPOS is the repository's source of truth, and every agent's recovery starts by reading it.
 * Until this gate existed, none of the AIPOS validators actually parsed these files: they read
 * them as text and matched patterns. On 2026-09-23 a strict parse of main found six work orders
 * that were not YAML at all (a bare backtick opening a list item; an unquoted `: ` inside a
 * scalar) and a duplicate `safety:` key in state.yaml, where a lenient parser silently keeps
 * the last value and a strict one refuses the whole file. Two readers of the same ledger could
 * therefore disagree about what it says, and nothing noticed.
 *
 * js-yaml rejects duplicate keys by default, so a clean load proves both properties.
 */

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const yaml = require("js-yaml");

const ROOT = join(__dirname, "..");

function trackedAiposYamlFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--", ".aipos/*.yaml", ".aipos/*.yml"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean).sort();
}

function validateAiposYaml(root = ROOT, files = trackedAiposYamlFiles(root)) {
  const failures = [];
  for (const file of files) {
    try {
      yaml.load(readFileSync(join(root, file), "utf8"), { filename: file });
    } catch (error) {
      failures.push({ file, reason: String(error.message).split("\n")[0] });
    }
  }
  return { checked: files.length, failures };
}

if (require.main === module) {
  const { checked, failures } = validateAiposYaml();
  if (checked === 0) {
    console.error("AIPOS_YAML FAIL no tracked AIPOS YAML files found");
    process.exit(1);
  }
  if (failures.length > 0) {
    for (const { file, reason } of failures) console.error(`AIPOS_YAML FAIL ${file}: ${reason}`);
    process.exit(1);
  }
  console.log(`AIPOS_YAML PASS (${checked} files parse strictly; no duplicate keys)`);
}

module.exports = { validateAiposYaml, trackedAiposYamlFiles };
