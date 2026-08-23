const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { PaperLearningEventRecorder } = require("../dist/apps/cloud/src/paperLearningObservability.js");

function tempDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-learning-"));
  return { directory, filename: path.join(directory, "cloud.sqlite") };
}

test("PAPER learning timeline survives restart without duplicates or sensitive execution identifiers", () => {
  const { directory, filename } = tempDatabase();
  try {
    const first = new PaperLearningEventRecorder({ persistencePath: filename, maximumEvents: 8 });
    first.record({
      cycleId: "paper:KRW-BTC:1000",
      stage: "FILL",
      occurredAt: 1_001,
      market: "KRW-BTC",
      status: "PASS",
      reason: "authorization=BearerSecret account_id=private-account token=abc",
      fill: { id: "raw-fill-id", orderId: "raw-order-id", side: "BUY", quantity: 0.01, price: 100_000, fee: 5, filledAt: 1_001, slippage: 1.25 }
    });
    first.close();

    const restarted = new PaperLearningEventRecorder({ persistencePath: filename, maximumEvents: 8 });
    const restored = restarted.replay();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].mode, "PAPER");
    assert.equal(restored[0].stage, "FILL");
    assert.equal(restored[0].fill.id, undefined);
    assert.equal(restored[0].fill.orderId, undefined);
    assert.equal(restored[0].fill.price, 100_000);
    assert.match(restored[0].reason, /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(restored[0]), /raw-fill-id|raw-order-id|private-account|BearerSecret|token=abc/);

    restarted.record({
      cycleId: "paper:KRW-BTC:1000",
      stage: "FILL",
      occurredAt: 1_001,
      market: "KRW-BTC",
      status: "PASS",
      reason: "duplicate replay",
      fill: { id: "another-fill-id", orderId: "another-order-id", side: "BUY", quantity: 0.01, price: 100_000, fee: 5, filledAt: 1_001 },
      idSuffix: ""
    });
    assert.equal(restarted.replay().length, 1);
    restarted.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PAPER learning persistence is bounded and malformed durable rows fail closed", () => {
  const { directory, filename } = tempDatabase();
  try {
    const recorder = new PaperLearningEventRecorder({ persistencePath: filename, maximumEvents: 3 });
    for (let index = 0; index < 5; index += 1) {
      recorder.record({ cycleId: `paper:KRW-BTC:${index}`, stage: "MARKET_DATA", occurredAt: 2_000 + index, market: "KRW-BTC", status: "PASS", reason: `tick-${index}` });
    }
    assert.deepEqual(recorder.replay().map((event) => event.occurredAt), [2_002, 2_003, 2_004]);
    recorder.close();

    const database = new DatabaseSync(filename);
    database.prepare("INSERT INTO paper_learning_observability_events (event_id, occurred_at, schema_version, payload_json) VALUES (?, ?, ?, ?)").run("malformed", 9_999, 1, "{not-json");
    database.prepare("INSERT INTO paper_learning_observability_events (event_id, occurred_at, schema_version, payload_json) VALUES (?, ?, ?, ?)").run("future-schema", 10_000, 99, JSON.stringify({ mode: "PAPER" }));
    database.close();

    const restarted = new PaperLearningEventRecorder({ persistencePath: filename, maximumEvents: 4 });
    const replay = restarted.replay();
    assert.equal(replay.length, 3);
    assert.deepEqual(replay.map((event) => event.occurredAt), [2_002, 2_003, 2_004]);
    assert.ok(replay.every((event) => event.mode === "PAPER"));
    restarted.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
