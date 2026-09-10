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

test("Research replay save freezes the legacy archive and persists later runs as immutable bounded segments", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-bounded-save-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const left = snapshot("one");
    const right = snapshot("two");
    const [first, second] = left.originalRunFingerprintSha256 > right.originalRunFingerprintSha256
      ? [left, right]
      : [right, left];

    store.save(first);
    const firstArchive = fs.readFileSync(filename);
    const firstStat = fs.statSync(filename);
    assert.ok(firstArchive.subarray(firstArchive.length - 3).equals(Buffer.from("]}\n")));

    store.save(second);
    assert.ok(fs.readFileSync(filename).equals(firstArchive), "legacy archive bytes never change after the first bounded snapshot");
    const secondStat = fs.statSync(filename);
    assert.equal(secondStat.ino, firstStat.ino, "legacy archive inode is not replaced by a whole-file copy");
    assert.equal(secondStat.size, firstStat.size, "legacy archive size stays fixed");

    const segment = path.join(`${filename}.segments`, `${second.originalRunFingerprintSha256}.json`);
    assert.equal(fs.existsSync(segment), true);
    assert.equal(JSON.parse(fs.readFileSync(segment, "utf8")).snapshotSha256, second.snapshotSha256);
    assert.equal(store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);

    const beforeDuplicateArchive = fs.readFileSync(filename);
    const beforeDuplicateSegment = fs.readFileSync(segment);
    store.save(second);
    assert.ok(fs.readFileSync(filename).equals(beforeDuplicateArchive), "exact replay never rewrites the legacy archive");
    assert.ok(fs.readFileSync(segment).equals(beforeDuplicateSegment), "exact replay never rewrites its immutable segment");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Research replay save publishes a stat-bound catalog while keeping the legacy archive byte-stable", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-latest-sidecar-"));
  const filename = path.join(directory, "snapshots.json");
  const sidecar = `${filename}.latest-identity.json`;
  const catalogPath = `${filename}.catalog.json`;
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const first = snapshot("sidecar-one");
    const secondCandidate = candidate("sidecar-two");
    const secondOptions = { generatedAt: "2026-01-02T00:00:00.000Z" };
    const secondRun = buildResearchRunLeague([secondCandidate], secondOptions);
    const second = createResearchRunReplaySnapshot([secondCandidate], secondOptions, secondRun);

    store.save(first);
    const archiveAfterFirst = fs.readFileSync(filename);
    store.save(second);
    assert.equal(fs.existsSync(sidecar), true, "segmented state publishes a downgrade fail-closed guard");
    const rollbackGuard = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    const archiveStat = fs.statSync(filename);
    assert.equal(rollbackGuard.archiveKey, `${archiveStat.dev}:${archiveStat.ino}:${archiveStat.size}:${archiveStat.mtimeMs}`);
    assert.equal(rollbackGuard.migrationGuard, "SEGMENTED_PERSISTENCE_REQUIRES_NEW_READER");
    assert.doesNotMatch(rollbackGuard.originalRunFingerprintSha256, /^[0-9a-f]{64}$/);
    assert.equal(fs.existsSync(catalogPath), true);
    assert.ok(fs.readFileSync(filename).equals(archiveAfterFirst), "catalog publication never mutates the legacy archive");

    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.entries.length, 2);
    const secondEntry = catalog.entries.find((entry) => entry.originalRunFingerprintSha256 === second.originalRunFingerprintSha256);
    assert.equal(secondEntry.source, "segment");
    assert.equal(secondEntry.snapshotSha256, second.snapshotSha256);
    assert.equal(secondEntry.generatedAt, second.options.generatedAt);

    assert.deepEqual(await store.latestIdentityAsync(), {
      originalRunFingerprintSha256: second.originalRunFingerprintSha256,
      generatedAt: second.options.generatedAt,
    });
    assert.equal(store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy single-file archives migrate once without rewriting historical bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-legacy-migrate-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const first = snapshot("legacy-one");
    const second = snapshot("legacy-two");
    fs.writeFileSync(filename, `${JSON.stringify({ schemaVersion: 1, snapshots: [first] })}\n`, { mode: 0o600 });
    const legacyBytes = fs.readFileSync(filename);
    const legacyStat = fs.statSync(filename);

    store.save(second);
    assert.ok(fs.readFileSync(filename).equals(legacyBytes), "legacy archive is frozen during migration");
    assert.equal(fs.statSync(filename).ino, legacyStat.ino);
    assert.equal(fs.existsSync(`${filename}.catalog.json`), true);
    assert.equal(fs.existsSync(path.join(`${filename}.segments`, `${second.originalRunFingerprintSha256}.json`)), true);
    assert.equal(store.read(first.originalRunFingerprintSha256)?.snapshotSha256, first.snapshotSha256);
    assert.equal(store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("segmented migration rebuilds catalog and downgrade guard after metadata loss", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-segment-recovery-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const first = snapshot("recovery-one");
    const secondCandidate = candidate("recovery-two");
    const secondOptions = { generatedAt: "2026-01-03T00:00:00.000Z" };
    const secondRun = buildResearchRunLeague([secondCandidate], secondOptions);
    const second = createResearchRunReplaySnapshot([secondCandidate], secondOptions, secondRun);

    store.save(first);
    store.save(second);
    fs.rmSync(`${filename}.catalog.json`, { force: true });
    fs.writeFileSync(`${filename}.latest-identity.json`, JSON.stringify({
      schemaVersion: 1,
      archiveKey: "stale",
      originalRunFingerprintSha256: first.originalRunFingerprintSha256,
      generatedAt: first.options.generatedAt,
      snapshotSha256: first.snapshotSha256,
      offset: 1,
      length: 1,
    }), "utf8");

    assert.deepEqual(await store.latestIdentityAsync(), {
      originalRunFingerprintSha256: second.originalRunFingerprintSha256,
      generatedAt: second.options.generatedAt,
    });
    assert.equal(fs.existsSync(`${filename}.catalog.json`), true);
    const guard = JSON.parse(fs.readFileSync(`${filename}.latest-identity.json`, "utf8"));
    assert.equal(guard.migrationGuard, "SEGMENTED_PERSISTENCE_REQUIRES_NEW_READER");
    assert.doesNotMatch(guard.originalRunFingerprintSha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("tampered immutable segment fails closed instead of becoming trusted recovery state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-segment-tamper-"));
  const filename = path.join(directory, "snapshots.json");
  const store = new FileResearchRunReplaySnapshotStore(filename);
  try {
    const first = snapshot("tamper-one");
    const second = snapshot("tamper-two");
    store.save(first);
    store.save(second);
    const segment = path.join(`${filename}.segments`, `${second.originalRunFingerprintSha256}.json`);
    fs.appendFileSync(segment, "x");
    assert.throws(() => store.read(second.originalRunFingerprintSha256), /corrupted|checksum|segment|catalog/i);
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
