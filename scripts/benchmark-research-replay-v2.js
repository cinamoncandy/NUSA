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

function measure(operation) {
  const original = {
    readSync: fs.readSync,
    copyFileSync: fs.copyFileSync,
    writeSync: fs.writeSync,
    writeFileSync: fs.writeFileSync,
  };
  const io = { readBytes: 0, copiedBytes: 0, writeBytes: 0, copyCalls: 0 };
  fs.readSync = (...args) => {
    const bytes = original.readSync(...args);
    if (typeof bytes === "number") io.readBytes += bytes;
    return bytes;
  };
  fs.copyFileSync = (...args) => {
    io.copyCalls += 1;
    try { io.copiedBytes += fs.statSync(args[0]).size; } catch { /* report only measurable bytes */ }
    return original.copyFileSync(...args);
  };
  fs.writeSync = (...args) => {
    const bytes = original.writeSync(...args);
    if (typeof bytes === "number") io.writeBytes += bytes;
    return bytes;
  };
  fs.writeFileSync = (file, data, ...rest) => {
    if (typeof data === "string" || Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
      io.writeBytes += Buffer.byteLength(Buffer.isBuffer(data) ? data : String(data));
    }
    return original.writeFileSync(file, data, ...rest);
  };
  const started = performance.now();
  try {
    operation();
    return { durationMs: Number((performance.now() - started).toFixed(3)), ...io };
  } finally {
    fs.readSync = original.readSync;
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
    schemaVersion: 1,
    baselineSnapshots: baselineCount,
    legacyArchiveBytesBefore: archiveBytesBefore,
    v1: v1Measurement,
    v2: v2Measurement,
    copiedByteReduction: v1Measurement.copiedBytes - v2Measurement.copiedBytes,
    measuredIoByteReduction:
      (v1Measurement.readBytes + v1Measurement.copiedBytes + v1Measurement.writeBytes)
      - (v2Measurement.readBytes + v2Measurement.copiedBytes + v2Measurement.writeBytes),
  }, null, 2)}\n`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
