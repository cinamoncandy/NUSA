"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { createResearchRunReplaySnapshot } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");

function candidate(id) {
  const generatedAt = "2026-01-01T00:00:00.000Z";
  const market = "KRW-BTC";
  const datasetId = `ds-${id}`;
  const contentSha256 = "c".repeat(64);
  const windows = Array.from({ length: 4 }, () => ({
    testResult: {
      metrics: { totalReturn: 0.03, benchmarkReturn: 0.02, excessReturn: 0.01, outperformance: 0.01 },
      benchmark: { strategyReturn: 0.03, buyAndHoldReturn: 0.02, outperformance: 0.01 },
    },
  }));
  const experiment = {
    manifest: {
      schemaVersion: 1, datasetId, source: "fixture", market, interval: "1d", candleCount: 200,
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
      costModelVersion: "fixture-cost-v1", generatedAt: "2025-12-31T23:00:00.000Z",
      evaluationStartedAt: "2025-12-31T23:05:00.000Z", evaluationEndedAt: "2025-12-31T23:30:00.000Z",
    },
  };
}

function snapshot(id) {
  const c = candidate(id);
  const options = { generatedAt: "2026-01-01T00:00:00.000Z" };
  const run = buildResearchRunLeague([c], options);
  return createResearchRunReplaySnapshot([c], options, run);
}

test("Research replay save is a byte-preserving append instead of a whole-archive re-sort", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-bounded-save-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const left = snapshot("one");
    const right = snapshot("two");
    // Save the lexicographically larger identity first. The legacy writer sorted the full
    // materialized archive by fingerprint, so the second save would move historical bytes.
    const [first, second] = left.originalRunFingerprintSha256 > right.originalRunFingerprintSha256
      ? [left, right]
      : [right, left];

    store.save(first);
    const firstArchive = fs.readFileSync(filename);
    assert.ok(firstArchive.subarray(firstArchive.length - 3).equals(Buffer.from("]}\n")));
    const immutablePrefix = firstArchive.subarray(0, firstArchive.length - 3);

    store.save(second);
    const appendedArchive = fs.readFileSync(filename);
    assert.ok(appendedArchive.subarray(0, immutablePrefix.length).equals(immutablePrefix), "historical snapshot bytes stay unchanged");
    const parsed = JSON.parse(appendedArchive.toString("utf8"));
    assert.deepEqual(
      parsed.snapshots.map((entry) => entry.originalRunFingerprintSha256),
      [first.originalRunFingerprintSha256, second.originalRunFingerprintSha256],
      "new snapshots append in durable arrival order instead of re-sorting the archive",
    );
    assert.equal(store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);

    const beforeDuplicate = fs.readFileSync(filename);
    store.save(second);
    assert.ok(fs.readFileSync(filename).equals(beforeDuplicate), "exact replay save is idempotent and performs no rewrite");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Research replay save publishes a stat-bound latest identity sidecar without changing archive bytes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-latest-sidecar-"));
  const filename = path.join(directory, "snapshots.json");
  const sidecar = `${filename}.latest-identity.json`;
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const first = snapshot("sidecar-one");
    // Make the second run uniquely newer without changing any qualification threshold.
    const secondCandidate = candidate("sidecar-two");
    const secondOptions = { generatedAt: "2026-01-02T00:00:00.000Z" };
    const secondRun = buildResearchRunLeague([secondCandidate], secondOptions);
    const second = createResearchRunReplaySnapshot([secondCandidate], secondOptions, secondRun);

    store.save(first);
    store.save(second);
    assert.equal(fs.existsSync(sidecar), true);
    const archiveBeforeIdentity = fs.readFileSync(filename);
    const cached = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    assert.equal(cached.schemaVersion, 1);
    assert.equal(cached.originalRunFingerprintSha256, second.originalRunFingerprintSha256);
    assert.equal(cached.snapshotSha256, second.snapshotSha256);
    assert.equal(cached.generatedAt, second.options.generatedAt);
    assert.ok(Number.isSafeInteger(cached.offset) && cached.offset > 0);
    assert.ok(Number.isSafeInteger(cached.length) && cached.length > 0);

    assert.deepEqual(await store.latestIdentityAsync(), {
      originalRunFingerprintSha256: second.originalRunFingerprintSha256,
      generatedAt: second.options.generatedAt,
    });
    assert.equal(store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);
    assert.ok(fs.readFileSync(filename).equals(archiveBeforeIdentity), "identity cache never mutates the immutable archive");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale latest identity sidecar never hides archive mutation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-stale-sidecar-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const entry = snapshot("stale-sidecar");
    store.save(entry);
    assert.equal(fs.existsSync(`${filename}.latest-identity.json`), true);
    // Change the canonical archive after sidecar publication. The stat-bound sidecar must be ignored,
    // forcing canonical validation instead of returning a stale cached identity.
    fs.appendFileSync(filename, "x");
    await assert.rejects(store.latestIdentityAsync(), /corrupted|worker failed closed/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
