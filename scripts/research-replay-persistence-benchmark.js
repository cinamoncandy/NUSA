"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { createResearchRunReplaySnapshot } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");

function parsePositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) throw new Error(`${name} must be an integer in [1, 100000]`);
  return value;
}

function candidate(id, generatedAt) {
  const market = "KRW-BTC";
  const datasetId = `bench-ds-${id}`;
  const contentSha256 = "c".repeat(64);
  const windows = Array.from({ length: 4 }, () => ({
    testResult: {
      metrics: { totalReturn: 0.03, benchmarkReturn: 0.02, excessReturn: 0.01, outperformance: 0.01 },
      benchmark: { strategyReturn: 0.03, buyAndHoldReturn: 0.02, outperformance: 0.01 },
    },
  }));
  const experiment = {
    manifest: {
      schemaVersion: 1, datasetId, source: "benchmark-fixture", market, interval: "1d", candleCount: 200,
      startOpenTime: 0, endCloseTime: 1, timezone: "UTC", ordering: "OPEN_TIME_ASC",
      missingCandlePolicy: "REJECT", missingCandleCount: 0, createdAt: generatedAt, contentSha256,
    },
    experimentConfig: {
      walkForward: {}, candidates: [{ id }], executionCosts: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 },
    },
    generatedAt,
    warnings: [],
    walkForwardResult: {
      windows, candidateSelectionCounts: {}, warnings: [],
      stabilityDiagnostics: { candidates: [], selectionChurn: 0, selectionChurnRatio: 0.2 },
      combinedOutOfSampleMetrics: {
        closedTradeNetProfit: 0, markedTotalReturn: 0.12, markedMaximumDrawdown: 0.1,
        windowCount: 4, totalOosPoints: 80, totalOosClosedTrades: 8, netProfit: 0,
        totalReturn: 0.12, maximumDrawdown: 0.1, winRate: 0.5, turnover: 1.5, exposure: 0.5,
        fees: 1000, spreadCost: 1000, slippageCost: 1000, totalTradingCost: 3000,
        profitableWindowRatio: 0.75, positiveExpectancyWindowRatio: 0.75,
        benchmarkOutperformanceWindowRatio: 1,
        equalWeight: { averageReturn: 0.03, averageBenchmarkReturn: 0.02, averageOutperformance: 0.01 },
        sequentialCompounded: { initialEquity: 10_000_000, finalEquity: 11_200_000, totalReturn: 0.12, maximumDrawdown: 0.1 },
      },
    },
  };
  return {
    id, familyId: "sma-crossover", experiment,
    candidateSpecification: {
      schemaVersion: 1, candidateId: id, familyId: "sma-crossover", lineageId: "sma-crossover-v1",
      parameters: {}, codeSha: "a".repeat(40), datasetId, datasetContentSha256: contentSha256,
      costModelVersion: "benchmark-cost-v1", generatedAt,
      evaluationStartedAt: generatedAt, evaluationEndedAt: generatedAt,
    },
  };
}

function snapshot(id, generatedAt) {
  const entry = candidate(id, generatedAt);
  const options = { generatedAt };
  const run = buildResearchRunLeague([entry], options);
  return createResearchRunReplaySnapshot([entry], options, run);
}

function syntheticArchive(filename, count) {
  const snapshots = [];
  for (let index = 0; index < count; index += 1) {
    const day = String((index % 27) + 1).padStart(2, "0");
    snapshots.push(snapshot(`seed-${String(index).padStart(6, "0")}`, `2026-01-${day}T00:00:00.000Z`));
  }
  fs.writeFileSync(filename, `${JSON.stringify({ schemaVersion: 1, snapshots })}\n`, { mode: 0o600 });
}

function main() {
  const seedCount = parsePositiveInt("NUSA_REPLAY_BENCH_SEED_COUNT", 16);
  const sourceArchive = (process.env.NUSA_REPLAY_BENCH_SOURCE || "").trim();
  const keep = process.env.NUSA_REPLAY_BENCH_KEEP === "1";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-persistence-bench-"));
  const filename = path.join(directory, "snapshots.json");

  try {
    if (sourceArchive) {
      const resolved = path.resolve(sourceArchive);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) throw new Error("NUSA_REPLAY_BENCH_SOURCE must be a regular file");
      fs.copyFileSync(resolved, filename);
    } else {
      syntheticArchive(filename, seedCount);
    }

    const archiveBytesBefore = fs.statSync(filename).size;
    const originalCopyFileSync = fs.copyFileSync;
    let copyFileCalls = 0;
    let copiedArchiveBytesObserved = 0;
    fs.copyFileSync = function observedCopyFileSync(source, destination, mode) {
      copyFileCalls += 1;
      if (path.resolve(String(source)) === path.resolve(filename)) copiedArchiveBytesObserved += fs.statSync(filename).size;
      return originalCopyFileSync.call(fs, source, destination, mode);
    };

    let elapsedNs;
    try {
      const store = new FileResearchRunReplaySnapshotStore(filename);
      const next = snapshot("benchmark-next-000001", "2026-12-31T00:00:00.000Z");
      const started = process.hrtime.bigint();
      store.save(next);
      elapsedNs = process.hrtime.bigint() - started;
    } finally {
      fs.copyFileSync = originalCopyFileSync;
    }

    const archiveBytesAfter = fs.statSync(filename).size;
    const receipt = Object.freeze({
      schemaVersion: 1,
      benchmark: "research-replay-persistence-save",
      sourceMode: sourceArchive ? "SOURCE_COPY" : "SYNTHETIC",
      seedCount: sourceArchive ? null : seedCount,
      archiveBytesBefore,
      archiveBytesAfter,
      saveElapsedMs: Number(elapsedNs) / 1_000_000,
      copyFileCalls,
      copiedArchiveBytesObserved,
      workAmplificationRatio: archiveBytesBefore > 0 ? copiedArchiveBytesObserved / archiveBytesBefore : 0,
      sourceArchiveMutated: false,
      safety: {
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      },
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (keep) process.stderr.write(`benchmarkCopy=${filename}\n`);
  } finally {
    if (!keep) fs.rmSync(directory, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
