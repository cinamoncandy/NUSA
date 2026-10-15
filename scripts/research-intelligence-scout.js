const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const {
  ArxivResearchIntelligenceCollector,
  ResearchIntelligenceScout,
} = require("../dist/apps/cloud/src/researchIntelligenceScout.js");
const {
  SqliteDatabase,
  SqliteResearchIntelligenceMemoryRepository,
} = require("../dist/packages/storage/src/index.js");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a value");
  return value;
}

function advisoryAvailability(result) {
  if (result.sourceErrors.length > 0) return "INSUFFICIENT_DATA";
  return result.records.length > 0 ? "AVAILABLE" : "NO_MATCHING_RESEARCH";
}

async function main() {
  const output = resolve(argument("--output", "artifacts/research-intelligence/latest.json"));
  const maxResults = Number(argument("--max-results", process.env.NUSA_RESEARCH_INTELLIGENCE_MAX_RESULTS || "20"));
  const databaseArg = argument("--db", process.env.NUSA_RESEARCH_INTELLIGENCE_DB || "");
  let database;
  try {
    const memory = databaseArg
      ? (() => {
          database = new SqliteDatabase(resolve(databaseArg));
          return new SqliteResearchIntelligenceMemoryRepository(database);
        })()
      : undefined;
    const collector = new ArxivResearchIntelligenceCollector({ maxResults });
    const scout = new ResearchIntelligenceScout([collector], memory);
    const result = await scout.run();

    const receipt = Object.freeze({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runMode: "ADVISORY_RESEARCH_ONLY",
      dedupScope: databaseArg
        ? "CANONICAL_SQLITE_RESEARCH_MEMORY"
        : "CURRENT_RUN_ONLY_WITH_CANONICAL_MEMORY_BINDING_AVAILABLE",
      canonicalMemoryIntegration: databaseArg
        ? "BOUND_TO_EXISTING_SEMANTIC_MEMORY_OWNER"
        : "AVAILABLE_BUT_NOT_ACTIVATED_WITHOUT_PERSISTENT_DB",
      advisoryAvailability: advisoryAvailability(result),
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
        advisoryAvailability: receipt.advisoryAvailability,
        safety: receipt.safety,
      }) + "\n",
    );

    if (result.sourceErrors.length > 0 && result.records.length === 0) {
      // Public-source availability is external, advisory evidence. Preserve a
      // machine-readable INSUFFICIENT_DATA receipt rather than failing a PR
      // whose code and deterministic contracts have already been verified.
      process.stderr.write("RESEARCH_INTELLIGENCE_INSUFFICIENT_DATA\n");
    }
  } finally {
    database?.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { advisoryAvailability, main };
