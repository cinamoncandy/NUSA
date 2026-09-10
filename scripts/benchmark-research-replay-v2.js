"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { createResearchRunReplaySnapshot } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");
const {
  FileResearchRunReplaySnapshotObjectStoreV2,
  migrateLegacyResearchRunReplayArchiveToV2,
} = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotObjectStoreV2.js");

const baselineCount = Math.max(2, Number.parseInt(process.env.NUSA_REPLAY_BENCH_SNAPSHOTS || "250", 10));

function candidate(id) {
  const generatedAt = "2026-01-01T00:00:00.000Z";
  const market = "KRW-BTC";
  const datasetId = `bench-${id}`;
  const contentSha256 = "c".repeat(64);
  const windows = Array.from({ length: 4 }, () => ({
    testResult: {
      metrics: { totalReturn: 0.03, benchmarkReturn: 0.02, excessReturn: 0.01, outperformance: 0.01 },
      benchmark: { strategyReturn: 0.03, buyAndHoldReturn: 0.02, outperformance: 0.01 },
    },
  }));
  return {
    id,
    familyId: "sma-crossover",
    experiment: {
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
    },
    candidateSpecification: {
      schemaVersion: 1, candidateId: id, familyId: "sma-crossover", lineageId: "sma-crossover-v1",
      parameters: {}, codeSha: "a".repeat(40), datasetId, datasetContentSha256: contentSha256,
      costModelVersion: "benchmark-cost-v1", generatedAt: "2025-12-31T23:00:00.000Z",
      evaluationStartedAt: "2025-12-31T23:05:00.000Z", evaluationEndedAt: "2025-12-31T23:30:00.000Z",
    },
  };
}

function snapshot(id, minute) {
  const c = candidate(id);
  const generatedAt = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  const options = { generatedAt };
  const run = buildResearchRunLeague([c], options);
  return createResearchRunReplaySnapshot([c], options, run);
}

function byteLength(value) {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

/**
 * Counts payload bytes exposed through the Node fs APIs used by the persistence paths. This is
 * intentionally API-level evidence, not a claim about filesystem cache hits or physical device
 * sectors. A copyFileSync source byte is reported separately because the kernel performs the copy;
 * `estimatedDataMovementBytes` conservatively treats each copied byte as one read + one write.
 */
function measure(operation) {
  const original = {
    readSync: fs.readSync,
    readFileSync: fs.readFileSync,
    copyFileSync: fs.copyFileSync,
    writeSync: fs.writeSync,
    writeFileSync: fs.writeFileSync,
  };
  const io = {
    explicitReadBytes: 0,
    explicitWriteBytes: 0,
    logicalCopyBytes: 0,
    readCalls: 0,
    writeCalls: 0,
    copyCalls: 0,
  };
  fs.readSync = (...args) => {
    const bytes = original.readSync(...args);
    if (typeof bytes === "number") {
      io.readCalls += 1;
      io.explicitReadBytes += bytes;
    }
    return bytes;
  };
  fs.readFileSync = (...args) => {
    const result = original.readFileSync(...args);
    io.readCalls += 1;
    io.explicitReadBytes += byteLength(result);
    return result;
  };
  fs.copyFileSync = (...args) => {
    io.copyCalls += 1;
    try { io.logicalCopyBytes += fs.statSync(args[0]).size; } catch { /* only count measurable copy payload */ }
    return original.copyFileSync(...args);
  };
  fs.writeSync = (...args) => {
    const bytes = original.writeSync(...args);
    if (typeof bytes === "number") {
      io.writeCalls += 1;
      io.explicitWriteBytes += bytes;
    }
    return bytes;
  };
  fs.writeFileSync = (file, data, ...rest) => {
    io.writeCalls += 1;
    io.explicitWriteBytes += byteLength(data);
    return original.writeFileSync(file, data, ...rest);
  };
  const started = performance.now();
  try {
    operation();
    const durationMs = Number((performance.now() - started).toFixed(3));
    return {
      durationMs,
      ...io,
      estimatedDataMovementBytes:
        io.explicitReadBytes + io.explicitWriteBytes + (2 * io.logicalCopyBytes),
    };
  } finally {
    fs.readSync = original.readSync;
    fs.readFileSync = original.readFileSync;
    fs.copyFileSync = original.copyFileSync;
    fs.writeSync = original.writeSync;
    fs.writeFileSync = original.writeFileSync;
  }
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-bench-"));
const legacy = path.join(directory, "legacy.json");
const v2Root = path.join(directory, "replay-v2");
try {
  const baseline = [];
  for (let index = 0; index < baselineCount; index += 1) baseline.push(snapshot(`baseline-${index}`, index));
  fs.writeFileSync(legacy, `${JSON.stringify({ schemaVersion: 1, snapshots: baseline })}\n`, { mode: 0o600 });
  migrateLegacyResearchRunReplayArchiveToV2(legacy, v2Root);
  const next = snapshot("next", baselineCount + 1);
  const archiveBytesBefore = fs.statSync(legacy).size;

  const v1 = new FileResearchRunReplaySnapshotStore(legacy);
  const v2 = new FileResearchRunReplaySnapshotObjectStoreV2(v2Root);
  const v1Measurement = measure(() => v1.save(next));
  const v2Measurement = measure(() => v2.save(next));

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 2,
    measurementSemantics: {
      explicitReadBytes: "payload bytes returned by fs.readSync/fs.readFileSync",
      explicitWriteBytes: "payload bytes passed through fs.writeSync/fs.writeFileSync",
      logicalCopyBytes: "source file size passed to fs.copyFileSync; zero means no whole-file copy",
      estimatedDataMovementBytes: "explicitReadBytes + explicitWriteBytes + 2 * logicalCopyBytes; API-level estimate, not physical disk sectors",
      durationMs: "single-run wall-clock observation; not a CI performance threshold",
    },
    baselineSnapshots: baselineCount,
    legacyArchiveBytesBefore: archiveBytesBefore,
    v1: v1Measurement,
    v2: v2Measurement,
    logicalCopyByteReduction: v1Measurement.logicalCopyBytes - v2Measurement.logicalCopyBytes,
    estimatedDataMovementByteReduction:
      v1Measurement.estimatedDataMovementBytes - v2Measurement.estimatedDataMovementBytes,
  }, null, 2)}\n`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
