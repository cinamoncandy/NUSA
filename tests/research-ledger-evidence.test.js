"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Data & Research Integrity: every repository file a ledger entry cites as evidence must exist, so an experiment's provenance
// stays reconstructable from main. Runtime-only evidence (production /health readings) cites no file and is allowed.
test("every file cited as research ledger evidence exists in the repository", () => {
  const root = path.join(__dirname, "..");
  const { experiments } = JSON.parse(fs.readFileSync(path.join(root, "docs", "research-ledger", "experiments.json"), "utf8"));
  const missing = [];
  for (const entry of experiments) {
    const refs = String(entry.evidence ?? "").match(/(?:scripts|docs)\/[A-Za-z0-9_./-]+\.(?:js|json|md|ts)/g) ?? [];
    if (refs.length === 0 && entry.source !== "PAPER_FORWARD") missing.push(`${entry.id}: no evidence file cited`);
    for (const ref of refs) if (!fs.existsSync(path.join(root, ref))) missing.push(`${entry.id}: ${ref}`);
  }
  assert.deepEqual(missing, []);
});
