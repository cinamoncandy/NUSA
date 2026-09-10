"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { createResearchRunReplaySnapshot } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");
const {
  FileResearchRunReplaySnapshotObjectStoreV2,
  migrateLegacyResearchRunReplayArchiveToV2,
} = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotObjectStoreV2.js");

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

function snapshot(id, generatedAt = "2026-01-01T00:00:00.000Z") {
  const c = candidate(id);
  const options = { generatedAt };
  const run = buildResearchRunLeague([c], options);
  return createResearchRunReplaySnapshot([c], options, run);
}

function sortedNames(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

test("v2 steady-state save writes one immutable record and tiny HEAD without whole-archive copy", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-bounded-"));
  const root = path.join(directory, "replay-v2");
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(root);
  const first = snapshot("v2-one", "2026-01-01T00:00:00.000Z");
  const second = snapshot("v2-two", "2026-01-02T00:00:00.000Z");
  const originalCopy = fs.copyFileSync;
  let copyCalls = 0;
  fs.copyFileSync = (...args) => { copyCalls += 1; return originalCopy(...args); };
  try {
    store.save(first);
    const firstRecordName = sortedNames(path.join(root, "records"))[0];
    assert.ok(firstRecordName);
    const firstRecordBefore = fs.readFileSync(path.join(root, "records", firstRecordName));

    store.save(second);
    const firstRecordAfter = fs.readFileSync(path.join(root, "records", firstRecordName));
    assert.ok(firstRecordAfter.equals(firstRecordBefore), "committed historical record bytes are immutable");
    assert.equal(copyCalls, 0, "v2 save never invokes whole-file copy");
    assert.equal(store.recordCount(), 2);
    assert.equal(sortedNames(path.join(root, "records")).length, 2);
    assert.equal(sortedNames(path.join(root, "by-fingerprint")).length, 2);
    assert.equal(store.read(second.originalRunFingerprintSha256).snapshotSha256, second.snapshotSha256);
    assert.equal(store.latestIdentity().originalRunFingerprintSha256, second.originalRunFingerprintSha256);
  } finally {
    fs.copyFileSync = originalCopy;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 exact duplicate save is idempotent and does not republish HEAD", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-idempotent-"));
  const root = path.join(directory, "replay-v2");
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(root);
  try {
    const entry = snapshot("v2-idempotent");
    store.save(entry);
    const headBefore = fs.readFileSync(path.join(root, "HEAD.json"));
    const recordsBefore = sortedNames(path.join(root, "records"));
    store.save(entry);
    assert.ok(fs.readFileSync(path.join(root, "HEAD.json")).equals(headBefore));
    assert.deepEqual(sortedNames(path.join(root, "records")), recordsBefore);
    assert.equal(store.recordCount(), 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 orphan immutable record is not committed until atomic HEAD publication", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-orphan-"));
  const sourceRoot = path.join(directory, "source-v2");
  const targetRoot = path.join(directory, "target-v2");
  try {
    const entry = snapshot("v2-orphan");
    const source = new FileResearchRunReplaySnapshotObjectStoreV2(sourceRoot);
    source.save(entry);
    const recordName = sortedNames(path.join(sourceRoot, "records"))[0];
    fs.mkdirSync(path.join(targetRoot, "records"), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "records", recordName), path.join(targetRoot, "records", recordName));

    const target = new FileResearchRunReplaySnapshotObjectStoreV2(targetRoot);
    assert.equal(target.recordCount(), 0, "record object alone is uncommitted without HEAD");
    assert.equal(target.read(entry.originalRunFingerprintSha256), undefined);
    target.save(entry);
    assert.equal(target.recordCount(), 1);
    assert.equal(target.read(entry.originalRunFingerprintSha256).snapshotSha256, entry.snapshotSha256);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 committed record corruption fails closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-corrupt-record-"));
  const root = path.join(directory, "replay-v2");
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(root);
  try {
    const entry = snapshot("v2-corrupt-record");
    store.save(entry);
    const recordName = sortedNames(path.join(root, "records"))[0];
    fs.chmodSync(path.join(root, "records", recordName), 0o600);
    fs.truncateSync(path.join(root, "records", recordName), 20);
    assert.throws(() => store.latestIdentity(), /record|corrupt|checksum|missing/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 stale or tampered HEAD fails closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-corrupt-head-"));
  const root = path.join(directory, "replay-v2");
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(root);
  try {
    store.save(snapshot("v2-corrupt-head"));
    const filename = path.join(root, "HEAD.json");
    const head = JSON.parse(fs.readFileSync(filename, "utf8"));
    head.count += 1;
    fs.writeFileSync(filename, `${JSON.stringify(head)}\n`);
    assert.throws(() => store.recordCount(), /HEAD|checksum|inconsistent/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 preserves legacy ambiguous-latest fail-closed semantics", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-latest-ambiguous-"));
  const store = new FileResearchRunReplaySnapshotObjectStoreV2(path.join(directory, "replay-v2"));
  try {
    store.save(snapshot("v2-tie-one", "2026-01-01T00:00:00.000Z"));
    store.save(snapshot("v2-tie-two", "2026-01-01T00:00:00.000Z"));
    assert.throws(() => store.latestIdentity(), /ambiguous/i);
    assert.throws(() => store.latest(), /ambiguous/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy migration resumes a committed prefix and preserves deterministic replay order", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-migrate-"));
  const legacy = path.join(directory, "legacy.json");
  const root = path.join(directory, "replay-v2");
  const staging = `${root}.migration-v2`;
  const legacyStore = new FileResearchRunReplaySnapshotStore(legacy);
  try {
    const entries = [
      snapshot("migrate-one", "2026-01-01T00:00:00.000Z"),
      snapshot("migrate-two", "2026-01-02T00:00:00.000Z"),
      snapshot("migrate-three", "2026-01-03T00:00:00.000Z"),
    ];
    for (const entry of entries) legacyStore.save(entry);

    const interrupted = new FileResearchRunReplaySnapshotObjectStoreV2(staging);
    interrupted.save(entries[0]);
    const result = migrateLegacyResearchRunReplayArchiveToV2(legacy, root);
    assert.equal(result.resumed, true);
    assert.equal(result.alreadyMigrated, false);
    assert.equal(result.recordCount, entries.length);
    assert.equal(fs.existsSync(staging), false);
    assert.equal(fs.existsSync(path.join(root, "MIGRATION.json")), true);

    const migrated = new FileResearchRunReplaySnapshotObjectStoreV2(root);
    assert.deepEqual(
      migrated.identities().map((entry) => [entry.originalRunFingerprintSha256, entry.snapshotSha256]),
      entries.map((entry) => [entry.originalRunFingerprintSha256, entry.snapshotSha256]),
    );
    assert.equal(migrated.verifyAll(), entries.length);

    const headBefore = fs.readFileSync(path.join(root, "HEAD.json"));
    const recordsBefore = sortedNames(path.join(root, "records"));
    const second = migrateLegacyResearchRunReplayArchiveToV2(legacy, root);
    assert.equal(second.alreadyMigrated, true);
    assert.equal(second.logicalReplaySha256, result.logicalReplaySha256);
    assert.ok(fs.readFileSync(path.join(root, "HEAD.json")).equals(headBefore));
    assert.deepEqual(sortedNames(path.join(root, "records")), recordsBefore);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupted legacy archive never publishes a v2 migration root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-replay-v2-migrate-corrupt-"));
  const legacy = path.join(directory, "legacy.json");
  const root = path.join(directory, "replay-v2");
  try {
    const legacyStore = new FileResearchRunReplaySnapshotStore(legacy);
    legacyStore.save(snapshot("migrate-corrupt"));
    const bytes = fs.readFileSync(legacy);
    fs.writeFileSync(legacy, bytes.subarray(0, Math.max(1, bytes.length - 7)));
    assert.throws(() => migrateLegacyResearchRunReplayArchiveToV2(legacy, root), /legacy|corrupt/i);
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
