const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { runPersistedForwardStudy, publishReceipt } = require("../scripts/lib/regime-forward-receipt");
const START = Date.parse("2026-10-14T00:00:00Z"), END = Date.parse("2026-12-13T00:00:00Z");
test("completed receipt replays without refetch and corrupt receipt fails closed", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-forward-receipt-"));
  const options = { stateDb: path.join(directory, "state.sqlite"), executionSourceSha: "a".repeat(40), now: () => END,
    fetchCandles: async () => ({ sourceRequests: [], candles: Array.from({ length: 1440 }, (_, i) => ({ market: "KRW-BTC", interval: "60m", openTime: START + i * 3600000, closeTime: START + (i + 1) * 3600000,
      open: 100, high: 101, low: 99, close: 100, volume: 1 })) }) };
  const result = await runPersistedForwardStudy(options);
  assert.equal(result.status, "INSUFFICIENT_DATA");
  const replay = await runPersistedForwardStudy({ ...options, fetchCandles: () => { throw Error("unexpected fetch"); } });
  assert.equal(replay.replayed, true); assert.equal(replay.contentSha256, result.contentSha256);
  const file = path.join(directory, "regime-forward-final-v1.json");
  const stored = JSON.parse(fs.readFileSync(file)); stored.result.status = "RESEARCH_SCREEN_PASS";
  fs.writeFileSync(file, JSON.stringify(stored));
  await assert.rejects(runPersistedForwardStudy(options), /RECEIPT_INVALID/);
});
test("waiting is not persisted as a completed receipt", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-forward-wait-"));
  const result = await runPersistedForwardStudy({ stateDb: path.join(directory, "state.sqlite"), executionSourceSha: "a".repeat(40), now: () => START });
  assert.equal(result.status, "WAITING_HOLDOUT"); assert.deepEqual(fs.readdirSync(directory), []);
});
test("interrupted receipt write never publishes a partial final; retry cannot overwrite", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-forward-atomic-"));
  const target = path.join(directory, "final.json");
  assert.throws(() => publishReceipt(target, { value: 1 }, { ...fs, writeFileSync: fd => { fs.writeFileSync(fd, "partial"); throw Error("SIMULATED_DISK_FAILURE"); } }), /DISK_FAILURE/);
  assert.equal(fs.existsSync(target), false);
  publishReceipt(target, { value: 1 });
  const original = fs.readFileSync(target, "utf8");
  assert.throws(() => publishReceipt(target, { value: 2 }), error => error.code === "EEXIST");
  assert.equal(fs.readFileSync(target, "utf8"), original);
});
