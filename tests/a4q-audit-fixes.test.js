const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AppLogger } = require("../dist/apps/desktop/src/appLogger.js");
const { sanitizeDiagnosticsValue } = require("../dist/apps/desktop/src/diagnosticsExport.js");
const { ShutdownSequence } = require("../dist/apps/desktop/src/shutdownSequence.js");

/**
 * WO-0034-A4Q audit fixes.
 *
 * Each test here fails against the code as it stood before the fix. They are regression
 * tests, not coverage: the point of every one is that the bound, the field, or the step it
 * checks was previously lost without anything reporting it.
 */

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nusa-a4q-"));
}

// ---------------------------------------------------------------------------
// 1. The logger prunes far less often, and the bounds it prunes for are unchanged.
// ---------------------------------------------------------------------------

test("A4Q: the size ceiling is still enforced on the line that would cross it", () => {
  const directory = tempDirectory();
  try {
    let clock = 1_700_000_000_000;
    const logger = new AppLogger({
      directory,
      runId: "run-1",
      now: () => clock,
      // Small enough that a handful of ordinary lines crosses both bounds, and an interval
      // long enough that a timer cannot be what triggers the sweep.
      policy: { maxFileBytes: 400, maxFiles: 3, maxAgeDays: 14, maxTotalBytes: 1200 },
      pruneIntervalMs: 60 * 60 * 1000
    });

    for (let index = 0; index < 400; index += 1) {
      clock += 1;
      logger.log({ channel: "MAIN", level: "INFO", message: `line-${index} ${"x".repeat(120)}` });
    }

    const diagnostics = logger.diagnostics();
    assert.ok(diagnostics.fileCount <= 3, `file count bound held, saw ${diagnostics.fileCount}`);
    assert.ok(
      diagnostics.totalBytes <= 1200,
      `total byte ceiling held without a per-line sweep, saw ${diagnostics.totalBytes}`
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("A4Q: an ordinary line does not sweep the directory, but the age bound is still swept", () => {
  const directory = tempDirectory();
  try {
    let clock = Date.UTC(2026, 0, 20);
    const logger = new AppLogger({
      directory,
      runId: "run-1",
      now: () => clock,
      policy: { maxFileBytes: 1024 * 1024, maxFiles: 10, maxAgeDays: 14, maxTotalBytes: 10 * 1024 * 1024 },
      pruneIntervalMs: 60_000
    });

    // An old file that only the age bound can catch. It is placed after the logger's first
    // line so the constructor's own state is already settled.
    logger.log({ channel: "MAIN", level: "INFO", message: "first" });
    const stale = path.join(directory, "app-2020-01-01.log");
    fs.writeFileSync(stale, "old\n");
    fs.utimesSync(stale, new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2020, 0, 1)));

    // Inside the interval: nothing is swept, so the stale file is still there. This is the
    // saving being claimed -- if it were gone, the sweep would still be running per line.
    clock += 1_000;
    logger.log({ channel: "MAIN", level: "INFO", message: "second" });
    assert.equal(fs.existsSync(stale), true, "no directory sweep on an ordinary line");

    // Past the interval: the age bound is re-checked and the stale file goes.
    clock += 61_000;
    logger.log({ channel: "MAIN", level: "INFO", message: "third" });
    assert.equal(fs.existsSync(stale), false, "the age bound is still enforced, on a timer");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("A4Q: rolling past the per-file size bound starts a new file rather than growing one", () => {
  const directory = tempDirectory();
  try {
    let clock = 1_700_000_000_000;
    const logger = new AppLogger({
      directory,
      runId: "run-1",
      now: () => clock,
      policy: { maxFileBytes: 500, maxFiles: 10, maxAgeDays: 14, maxTotalBytes: 10 * 1024 * 1024 },
      pruneIntervalMs: 60 * 60 * 1000
    });

    for (let index = 0; index < 20; index += 1) {
      clock += 1;
      logger.log({ channel: "MAIN", level: "INFO", message: `line-${index} ${"y".repeat(100)}` });
    }

    const files = fs.readdirSync(directory).filter((name) => name.endsWith(".log"));
    assert.ok(files.length > 1, "the cached target still rolls over when the file fills");
    for (const name of files) {
      const size = fs.statSync(path.join(directory, name)).size;
      // One line may cross the bound; nothing may keep being appended after that.
      assert.ok(size < 500 + 200, `${name} respects the per-file bound, saw ${size}`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("A4Q: a day rollover opens the next day's file", () => {
  const directory = tempDirectory();
  try {
    let clock = Date.UTC(2026, 0, 20, 23, 59, 0);
    const logger = new AppLogger({ directory, runId: "run-1", now: () => clock, pruneIntervalMs: 60 * 60 * 1000 });
    logger.log({ channel: "MAIN", level: "INFO", message: "before midnight" });
    clock = Date.UTC(2026, 0, 21, 0, 1, 0);
    logger.log({ channel: "MAIN", level: "INFO", message: "after midnight" });

    const names = fs.readdirSync(directory).sort();
    assert.deepEqual(names, ["app-2026-01-20.log", "app-2026-01-21.log"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("A4Q: a channel keeps its own file, and the cache does not cross channels", () => {
  const directory = tempDirectory();
  try {
    const logger = new AppLogger({ directory, runId: "run-1", now: () => Date.UTC(2026, 0, 20), pruneIntervalMs: 60 * 60 * 1000 });
    logger.log({ channel: "MAIN", level: "INFO", message: "routine" });
    logger.log({ channel: "CRASH", level: "ERROR", message: "it stopped" });
    logger.log({ channel: "MAIN", level: "INFO", message: "routine again" });

    assert.equal(fs.readFileSync(path.join(directory, "crash-2026-01-20.log"), "utf8").split("\n").filter(Boolean).length, 1);
    assert.equal(fs.readFileSync(path.join(directory, "app-2026-01-20.log"), "utf8").split("\n").filter(Boolean).length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. A diagnostics key containing a dot survives sanitisation intact.
// ---------------------------------------------------------------------------

test("A4Q: a key containing a dot is neither renamed nor collided with another", () => {
  const withheld = [];
  const sanitized = sanitizeDiagnosticsValue(
    {
      "KRW-BTC": { last: 1 },
      "app.version": "0.1.0",
      "electron.version": "38.0.0",
      // Two keys whose last dot-separated segment is identical. Before the fix both were
      // written as "version" and the second silently replaced the first.
      nested: { "market.code": "KRW-ETH", "order.code": "BID" }
    },
    withheld
  );

  assert.deepEqual(Object.keys(sanitized).sort(), ["KRW-BTC", "app.version", "electron.version", "nested"]);
  assert.equal(sanitized["app.version"], "0.1.0");
  assert.equal(sanitized["electron.version"], "38.0.0");
  assert.deepEqual(sanitized.nested, { "market.code": "KRW-ETH", "order.code": "BID" });
  assert.deepEqual(withheld, []);
});

test("A4Q: a withheld field is still reported by its full path, not by its bare name", () => {
  const withheld = [];
  const sanitized = sanitizeDiagnosticsValue({ inner: { apiKey: "value" } }, withheld, "safety");
  assert.deepEqual(sanitized, { inner: {} });
  assert.deepEqual(withheld, ["safety.inner.apiKey"], "the path is what tells a reader where it came from");
});

// ---------------------------------------------------------------------------
// 3. A failing progress callback cannot abort the shutdown.
// ---------------------------------------------------------------------------

function shutdownHarness(overrides = {}) {
  const calls = [];
  const deps = Object.assign(
    {
      runId: "run-1",
      observationIsRunning: () => true,
      currentSessionId: () => "shadow-1",
      stopSignalIntake: () => calls.push("STOP_SIGNALS"),
      unsubscribeMarket: () => calls.push("UNSUBSCRIBE_MARKET"),
      clearTimers: () => calls.push("CLEAR_TIMERS"),
      flushEvidence: async () => { calls.push("FLUSH_EVIDENCE"); },
      recordRecovery: () => calls.push("RECORD_RECOVERY"),
      beginShutdownRecord: () => calls.push("BEGIN_MARKER"),
      completeShutdownRecord: () => calls.push("COMPLETE_MARKER"),
      onProgress: () => {},
      now: () => 1_700_000_000_000
    },
    overrides
  );
  return { sequence: new ShutdownSequence(deps), calls };
}

test("A4Q: a window that is already gone cannot stop the archive being sealed and marked clean", async () => {
  // This is what a destroyed BrowserWindow does when something still sends to it.
  const h = shutdownHarness({
    onProgress: () => {
      throw new Error("Object has been destroyed");
    }
  });

  const progress = await h.sequence.run();

  assert.deepEqual(
    h.calls,
    ["BEGIN_MARKER", "STOP_SIGNALS", "UNSUBSCRIBE_MARKET", "CLEAR_TIMERS", "FLUSH_EVIDENCE", "RECORD_RECOVERY", "COMPLETE_MARKER"],
    "every step still ran, in order"
  );
  assert.equal(progress.phase, "COMPLETE");
  assert.equal(progress.evidenceSealed, true);
  assert.equal(
    progress.cleanShutdown,
    true,
    "the clean marker was written, so the next launch does not mistake a tidy quit for a crash"
  );
});

test("A4Q: a real step failure is still reported as a failure and still leaves no clean marker", async () => {
  // The swallow above must not have turned into a swallow of everything.
  const h = shutdownHarness({
    flushEvidence: async () => {
      throw new Error("archive locked");
    }
  });

  const progress = await h.sequence.run();
  assert.equal(progress.phase, "FAILED");
  assert.equal(progress.evidenceSealed, false);
  assert.equal(progress.cleanShutdown, false);
  assert.equal(h.calls.includes("COMPLETE_MARKER"), false, "no clean marker after a failed seal");
});
