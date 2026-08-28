import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteDatabase } from "./index";
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
