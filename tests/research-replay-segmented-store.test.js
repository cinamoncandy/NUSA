"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { createResearchRunReplaySnapshot } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
const { SegmentedResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySegmentedStore.js");

function candidate(id, generatedAt) {
  const generatedMs = Date.parse(generatedAt);
  const at = (minutesBefore) => new Date(generatedMs - minutesBefore * 60_000).toISOString();
  const market = "KRW-BTC";
  const datasetId = `segmented-ds-${id}`;
  const contentSha256 = "c".repeat(64);
  const windows = Array.from({ length: 4 }, () => ({
    testResult: {
      metrics: { totalReturn: 0.03, benchmarkReturn: 0.02, excessReturn: 0.01, outperformance: 0.01 },
      benchmark: { strategyReturn: 0.03, buyAndHoldReturn: 0.02, outperformance: 0.01 },
    },
  }));
  const experiment = {
    manifest: {
      schemaVersion: 1, datasetId, source: "segmented-fixture", market, interval: "1d", candleCount: 200,
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
      costModelVersion: "segmented-fixture-cost-v1", generatedAt: at(60),
      evaluationStartedAt: at(55), evaluationEndedAt: at(30),
    },
  };
}

function snapshot(id, generatedAt) {
  const entry = candidate(id, generatedAt);
  const options = { generatedAt };
  const run = buildResearchRunLeague([entry], options);
  return createResearchRunReplaySnapshot([entry], options, run);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-segmented-"));
  return {
    root,
    store: new SegmentedResearchRunReplaySnapshotStore(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function committedCounts(root) {
  const segments = path.join(root, "segments");
  const commits = path.join(root, "commits");
  return {
    segments: fs.existsSync(segments) ? fs.readdirSync(segments).filter((entry) => entry.endsWith(".json")).length : 0,
    commits: fs.existsSync(commits) ? fs.readdirSync(commits).filter((entry) => entry.endsWith(".json")).length : 0,
  };
}

test("segmented replay store commits immutable snapshots in deterministic arrival order", async () => {
  const f = fixture();
  try {
    const first = snapshot("segmented-one", "2026-01-01T00:00:00.000Z");
    const second = snapshot("segmented-two", "2026-01-02T00:00:00.000Z");

    assert.equal(f.store.latest(), undefined);
    assert.deepEqual(f.store.list(), []);

    f.store.save(first);
    const headAfterFirst = fs.readFileSync(path.join(f.root, "head.json"));
    assert.deepEqual(committedCounts(f.root), { segments: 1, commits: 1 });

    f.store.save(first);
    assert.ok(fs.readFileSync(path.join(f.root, "head.json")).equals(headAfterFirst), "exact duplicate does not advance the commit head");
    assert.deepEqual(committedCounts(f.root), { segments: 1, commits: 1 });

    f.store.save(second);
    assert.deepEqual(committedCounts(f.root), { segments: 2, commits: 2 });
    assert.equal(f.store.read(first.originalRunFingerprintSha256)?.snapshotSha256, first.snapshotSha256);
    assert.equal(f.store.read(second.originalRunFingerprintSha256)?.snapshotSha256, second.snapshotSha256);
    assert.equal(f.store.latest()?.snapshotSha256, second.snapshotSha256);
    assert.deepEqual(
      f.store.list().map((entry) => entry.originalRunFingerprintSha256),
      [first.originalRunFingerprintSha256, second.originalRunFingerprintSha256],
    );
    assert.deepEqual(await f.store.latestIdentityAsync(), {
      originalRunFingerprintSha256: second.originalRunFingerprintSha256,
      generatedAt: "2026-01-02T00:00:00.000Z",
    });
  } finally { f.cleanup(); }
});

test("orphan segment from an interrupted pre-head write is invisible until a later valid commit", () => {
  const f = fixture();
  try {
    const first = snapshot("committed", "2026-02-01T00:00:00.000Z");
    const orphan = snapshot("orphan", "2026-02-02T00:00:00.000Z");
    f.store.save(first);

    const orphanPath = path.join(f.root, "segments", `${orphan.originalRunFingerprintSha256}.json`);
    fs.writeFileSync(orphanPath, `${JSON.stringify(orphan)}\n`, { mode: 0o600, flag: "wx" });

    assert.equal(f.store.read(orphan.originalRunFingerprintSha256), undefined, "unreferenced immutable bytes are not committed evidence");
    assert.deepEqual(f.store.list().map((entry) => entry.snapshotSha256), [first.snapshotSha256]);

    f.store.save(orphan);
    assert.equal(f.store.read(orphan.originalRunFingerprintSha256)?.snapshotSha256, orphan.snapshotSha256);
    assert.deepEqual(committedCounts(f.root), { segments: 2, commits: 2 });
  } finally { f.cleanup(); }
});

test("stale writer lock fails closed instead of guessing ownership", () => {
  const f = fixture();
  try {
    const first = snapshot("lock-first", "2026-03-01T00:00:00.000Z");
    const second = snapshot("lock-second", "2026-03-02T00:00:00.000Z");
    f.store.save(first);
    fs.writeFileSync(path.join(f.root, "writer.lock"), "stale-owner\n", { mode: 0o600, flag: "wx" });

    assert.throws(() => f.store.save(second), /writer lock is unavailable/);
    assert.equal(f.store.latest()?.snapshotSha256, first.snapshotSha256);
  } finally { f.cleanup(); }
});

test("tampered commit checksum fails closed before exposing the snapshot", () => {
  const f = fixture();
  try {
    const first = snapshot("commit-tamper", "2026-04-01T00:00:00.000Z");
    f.store.save(first);
    const head = JSON.parse(fs.readFileSync(path.join(f.root, "head.json"), "utf8"));
    const commitPath = path.join(f.root, "commits", head.commitFile);
    const commit = JSON.parse(fs.readFileSync(commitPath, "utf8"));
    commit.snapshotSha256 = "f".repeat(64);
    fs.writeFileSync(commitPath, `${JSON.stringify(commit)}\n`);

    assert.throws(() => f.store.latest(), /checksum mismatch|head provenance mismatch|invalid/);
    assert.throws(() => f.store.list(), /checksum mismatch|head provenance mismatch|invalid/);
  } finally { f.cleanup(); }
});

test("truncated committed segment fails closed", () => {
  const f = fixture();
  try {
    const first = snapshot("segment-truncate", "2026-05-01T00:00:00.000Z");
    f.store.save(first);
    const segmentPath = path.join(f.root, "segments", `${first.originalRunFingerprintSha256}.json`);
    fs.writeFileSync(segmentPath, "{");

    assert.throws(() => f.store.latest(), /segment is corrupted/);
    assert.throws(() => f.store.read(first.originalRunFingerprintSha256), /segment is corrupted/);
  } finally { f.cleanup(); }
});

test("corrupt head fails closed while unreferenced immutable files remain non-authoritative", () => {
  const f = fixture();
  try {
    const first = snapshot("head-corrupt", "2026-06-01T00:00:00.000Z");
    f.store.save(first);
    fs.writeFileSync(path.join(f.root, "head.json"), "{broken");

    assert.throws(() => f.store.latest(), /head is corrupted/);
    assert.throws(() => f.store.list(), /head is corrupted/);
  } finally { f.cleanup(); }
});
