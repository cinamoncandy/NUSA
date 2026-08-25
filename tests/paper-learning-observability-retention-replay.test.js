const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { PaperLearningEventRecorder } = require("../dist/apps/cloud/src/paperLearningObservability.js");

// Reopening with a smaller retention limit reproduces an oversized durable history at startup.
test("durable PAPER learning replay hydrates the newest retained window", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-learning-retention-"));
  const persistencePath = join(directory, "state.sqlite");

  try {
    const writer = new PaperLearningEventRecorder({ persistencePath, maximumEvents: 5 });
    for (let index = 0; index < 5; index += 1) {
      writer.record({
        cycleId: `paper:TEST:${index}`,
        stage: "MARKET_DATA",
        occurredAt: 1_000 + index,
        market: "TEST",
        status: "PASS"
      });
    }
    assert.deepEqual(writer.replay().map((event) => event.cycleId), [
      "paper:TEST:0",
      "paper:TEST:1",
      "paper:TEST:2",
      "paper:TEST:3",
      "paper:TEST:4"
    ]);
    writer.close();

    const restarted = new PaperLearningEventRecorder({ persistencePath, maximumEvents: 3 });
    assert.deepEqual(restarted.replay().map((event) => event.cycleId), [
      "paper:TEST:2",
      "paper:TEST:3",
      "paper:TEST:4"
    ]);
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
