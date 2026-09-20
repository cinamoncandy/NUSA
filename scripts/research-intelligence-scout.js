const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const {
  ArxivResearchIntelligenceCollector,
  ResearchIntelligenceScout,
} = require("../dist/apps/cloud/src/researchIntelligenceScout.js");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a value");
  return value;
}

async function main() {
  const output = resolve(argument("--output", "artifacts/research-intelligence/latest.json"));
  const maxResults = Number(argument("--max-results", process.env.NUSA_RESEARCH_INTELLIGENCE_MAX_RESULTS || "20"));
  const collector = new ArxivResearchIntelligenceCollector({ maxResults });
  const scout = new ResearchIntelligenceScout([collector]);
  const result = await scout.run();

  const receipt = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runMode: "ADVISORY_RESEARCH_ONLY",
    dedupScope: "CURRENT_RUN_ONLY_UNTIL_CANONICAL_RESEARCH_MEMORY_INTEGRATION",
    canonicalMemoryIntegration: "SEMANTIC_MEMORY_CONTRACT_AVAILABLE_RUNTIME_BINDING_PENDING_1906",
    sourceRegistry: ["arxiv"],
    metrics: Object.freeze({
      discovered: result.discovered,
      accepted: result.accepted,
      duplicatesSuppressed: result.duplicatesSuppressed,
      axiomHandoffs: result.axiomHandoffs.length,
      sourceErrors: result.sourceErrors.length,
    }),
    records: result.records,
    axiomHandoffs: result.axiomHandoffs,
    sourceErrors: result.sourceErrors,
    safety: Object.freeze({
      authority: result.authority,
      liveAuthority: result.liveAuthority,
      productionMutationAllowed: result.productionMutationAllowed,
      aiAuthority: result.aiAuthority,
      strategyPromotionAllowed: false,
      paperAllocationAllowed: false,
    }),
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  process.stdout.write(
    JSON.stringify({
      output,
      metrics: receipt.metrics,
      safety: receipt.safety,
    }) + "\n",
  );

  if (result.sourceErrors.length > 0 && result.records.length === 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
