import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteDatabase } from "./index";
import { SqlitePersistedPaperPeriodStore } from "./persistedPaperPeriodStore";
import { PaperMarketObservationStoreError, SqlitePaperMarketObservationRepository } from "./paperMarketObservationRepository";

const observation = (observedAt: number, price: number) => ({
  market: "KRW-BTC",
  observedAt,
  price,
  signedChangeRate: 0.01,
  accumulatedVolume: 10,
  accumulatedPrice: 1_000_000,
});

function code(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof PaperMarketObservationStoreError) return error.code;
    throw error;
  }
  throw new Error("expected PaperMarketObservationStoreError");
}

test("public PAPER market observations are durable, deterministic, deduplicated, and bounded", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-market-observations-")), "state.db");
  const first = new SqliteDatabase(filename);
  try {
    new SqlitePersistedPaperPeriodStore(first);
    const repository = new SqlitePaperMarketObservationRepository(first, 2);
    assert.equal(repository.append(observation(100, 100)), "RECORDED");
    assert.equal(repository.append(observation(200, 110)), "RECORDED");
    assert.equal(repository.append(observation(200, 110)), "DUPLICATE");
    assert.equal(repository.append(observation(300, 120)), "RECORDED");
    assert.equal(repository.count(), 2);
    assert.deepEqual(repository.list().map((item) => [item.observedAt, item.price]), [[200, 110], [300, 120]]);
    assert.equal(code(() => repository.append(observation(200, 111))), "OBSERVATION_ID_CONFLICT");
  } finally { first.close(); }

  const restarted = new SqliteDatabase(filename);
  try {
    new SqlitePersistedPaperPeriodStore(restarted);
    const repository = new SqlitePaperMarketObservationRepository(restarted, 2);
    assert.deepEqual(repository.list().map((item) => [item.observedAt, item.price]), [[200, 110], [300, 120]]);
    assert.deepEqual(repository.readWindow("krw-btc", 200, 300).map((item) => item.observedAt), [200, 300]);
  } finally { restarted.close(); }
});

test("malformed persisted public evidence is rejected before it can be projected", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqlitePaperMarketObservationRepository(db);
    repository.append(observation(100, 100));
    db.connection.prepare("UPDATE paper_public_market_observations SET payload_json = ?").run("{}");
    assert.equal(code(() => repository.list()), "INVALID_MARKET");
  } finally { db.close(); }
});

test("unexpected credential-shaped input is not persisted or returned", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqlitePaperMarketObservationRepository(db);
    const unsafe = Object.assign(observation(100, 100), { access_token: "do-not-persist" });
    repository.append(unsafe);
    assert.doesNotMatch(JSON.stringify(repository.list()), /do-not-persist|access_token/);
    const row = db.connection.prepare("SELECT payload_json FROM paper_public_market_observations").get() as { payload_json?: string };
    assert.doesNotMatch(String(row?.payload_json ?? ""), /do-not-persist|access_token/);
  } finally { db.close(); }
});


test("canonical source fingerprint is preserved, validated, and covered by evidence checksum", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqlitePaperMarketObservationRepository(db);
    const fingerprint = "a".repeat(64);
    assert.equal(repository.append({ ...observation(400, 130), sourceFingerprint: fingerprint }), "RECORDED");
    const stored = repository.list()[0];
    assert.equal(stored?.sourceFingerprint, fingerprint);
    assert.equal(code(() => repository.append({ ...observation(500, 140), sourceFingerprint: "not-a-sha256" })), "INVALID_SOURCE_FINGERPRINT");
    db.connection.prepare("UPDATE paper_public_market_observations SET payload_json = replace(payload_json, ?, ?) WHERE observation_id = ?")
      .run(fingerprint, "b".repeat(64), "paper-market:KRW-BTC:400");
    assert.equal(code(() => repository.list()), "OBSERVATION_CHECKSUM_MISMATCH");
  } finally { db.close(); }
});

test("open PAPER period protects benchmark observations beyond the ordinary retention cap", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-market-protected-retention-")), "state.db");
  const first = new SqliteDatabase(filename);
  try {
    new SqlitePersistedPaperPeriodStore(first);
    const repository = new SqlitePaperMarketObservationRepository(first, 2);
    repository.append(observation(10, 90));
    repository.append(observation(20, 91));
    first.connection.prepare("INSERT INTO research_paper_forward_period_pending (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)")
      .run("protected-period", 0, 100, "{}", "checksum");
    for (let observedAt = 100; observedAt <= 600; observedAt += 100) repository.append(observation(observedAt, 100 + observedAt));

    assert.deepEqual(repository.readWindow("KRW-BTC", 100, 600).map((item) => item.observedAt), [100, 200, 300, 400, 500, 600]);
    assert.equal(repository.count(), 8);
  } finally { first.close(); }

  const restarted = new SqliteDatabase(filename);
  try {
    new SqlitePersistedPaperPeriodStore(restarted);
    const repository = new SqlitePaperMarketObservationRepository(restarted, 2);
    repository.append(observation(700, 800));
    assert.deepEqual(repository.readWindow("KRW-BTC", 100, 700).map((item) => item.observedAt), [100, 200, 300, 400, 500, 600, 700]);
    restarted.connection.prepare("DELETE FROM research_paper_forward_period_pending WHERE period_id = ?").run("protected-period");
    repository.append(observation(800, 900));
    assert.deepEqual(repository.list().map((item) => item.observedAt), [700, 800]);
  } finally { restarted.close(); }
});

test("multiple open periods use the earliest protection floor across markets", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    new SqlitePersistedPaperPeriodStore(db);
    const repository = new SqlitePaperMarketObservationRepository(db, 2);
    db.connection.prepare("INSERT INTO research_paper_forward_period_pending (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)")
      .run("period-late", 1, 300, "{}", "late");
    db.connection.prepare("INSERT INTO research_paper_forward_period_pending (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)")
      .run("period-early", 0, 100, "{}", "early");
    repository.append(observation(50, 50));
    repository.append(observation(100, 100));
    repository.append({ ...observation(200, 200), market: "KRW-XRP" });
    repository.append(observation(300, 300));
    repository.append({ ...observation(400, 400), market: "KRW-XRP" });
    assert.deepEqual(repository.list().map((item) => [item.market, item.observedAt]), [["KRW-BTC", 50], ["KRW-BTC", 100], ["KRW-XRP", 200], ["KRW-BTC", 300], ["KRW-XRP", 400]]);
  } finally { db.close(); }
});

test("unverifiable protection floor fails closed without deleting observations", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    new SqlitePersistedPaperPeriodStore(db);
    const repository = new SqlitePaperMarketObservationRepository(db, 2);
    db.connection.prepare("INSERT INTO research_paper_forward_period_pending (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)")
      .run("valid-floor", 0, 250, "{}", "valid-checksum");
    db.connection.prepare("INSERT INTO research_paper_forward_period_pending (period_id, period_index, period_start_at, payload_json, checksum) VALUES (?, ?, ?, ?, ?)")
      .run("malformed-floor", 1, "not-a-time", "{}", "checksum");
    repository.append(observation(100, 100));
    repository.append(observation(200, 200));
    repository.append(observation(300, 300));
    assert.equal(repository.count(), 3);
  } finally { db.close(); }
});
