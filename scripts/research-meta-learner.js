#!/usr/bin/env node
"use strict";
/**
 * Offline CLI of the research meta-learner (WO-RESEARCH-20261013-META-LEARNER). The rules live in one place,
 * packages/contracts/src/researchMetaLearning.ts, which the runtime also evaluates on /health; this script transpiles that module
 * and applies it to docs/research-ledger/experiments.json. Read-only.
 *   node scripts/research-meta-learner.js                  print lessons, ranking and the next holdout bar
 *   node scripts/research-meta-learner.js --emit-snapshot  rewrite apps/cloud/src/researchLedgerSnapshot.ts from the JSON ledger
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const LEDGER = path.join(ROOT, "docs", "research-ledger", "experiments.json");
const SNAPSHOT = path.join(ROOT, "apps", "cloud", "src", "researchLedgerSnapshot.ts");
const POLICY_KEYS = ["id", "source", "dataType", "timeframe", "universe", "methodClass", "configs", "discoveryPass", "holdoutPass", "designFlaw", "retryOf"];

function loadPolicy() {
  const file = path.join(ROOT, "packages", "contracts", "src", "researchMetaLearning.ts");
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, require);
  return mod.exports;
}

const policyEntries = (ledger) => ledger.experiments.map((e) => Object.fromEntries(POLICY_KEYS.filter((k) => k in e).map((k) => [k, e[k]])));

const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
if (process.argv.includes("--emit-snapshot")) {
  const rows = policyEntries(ledger).map((r) => `  ${JSON.stringify(r)}`).join(",\n");
  const head = fs.readFileSync(SNAPSHOT, "utf8").split("export const RESEARCH_LEDGER_SNAPSHOT")[0];
  fs.writeFileSync(SNAPSHOT, `${head}export const RESEARCH_LEDGER_SNAPSHOT: readonly ResearchLedgerEntry[] = Object.freeze([\n${rows},\n] as ResearchLedgerEntry[]);\n`);
  console.log(`wrote ${path.relative(ROOT, SNAPSHOT)} (${ledger.experiments.length} entries)`);
  process.exit(0);
}
const report = loadPolicy().evaluateMetaLearning(policyEntries(ledger));
console.log(`LEDGER: ${report.experiments} experiments, ${report.configurations} configurations, ${report.discoveryPasses} discovery passes, ${report.holdoutPasses} holdout passes`);
console.log(`overfit rate: ${report.overfitRatePercent ?? "n/a"}% of discovery passes failed on unseen data; valid knowledge per 100 configurations: ${report.validKnowledgePer100Configs}`);
console.log(`exhausted: ${report.exhausted.join(", ") || "none"}`);
console.log(`untried: ${report.untried.join(", ") || "none"}`);
console.log("\nNEXT EXPERIMENTS (score = novelty - collection cost)");
for (const r of report.ranked.slice(0, 6)) console.log(`${r.combination} | score ${r.score}${r.prerequisites.length ? ` | needs: ${r.prerequisites.join(", ")}` : ""}`);
console.log(`\nRECOMMENDED: ${report.recommended ?? "none"}`);
console.log(`next holdout bar (1 configuration): p < ${report.nextHoldoutBar.toExponential(2)}`);
