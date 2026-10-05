const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop, describePersistenceFailure } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

const command = (overrides = {}) => ({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey: "paper-detail-0000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001, ...overrides });
const context = () => ({ now: 1_700_000_000_100, marketPrice: 50_000_000, observedAt: 1_700_000_000_090, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" });
const failingLoop = (error) => new PaperTradingExecutionLoop({ initialCapital: 1_000_000, repository: { save() { throw error; }, loadLatest() { return undefined; }, clear() {} }, readP0State: () => ({ openP0: false }) });

test("a failed save keeps the stable reason and records why, without changing the result", () => {
  const loop = failingLoop(Object.assign(new Error("attempt to write a readonly database"), { code: "SQLITE_READONLY" }));
  assert.equal(loop.persistenceFailureDetail(), null, "nothing recorded before a failure");
  const failed = loop.submitManualOrder(command(), context());
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.reason, "paper account persistence failed", "the contract string is unchanged");
  assert.equal(loop.persistenceFailureDetail(), "SQLITE_READONLY attempt to write a readonly database");
});

test("the description is short, printable and cannot carry a path, payload or secret-looking punctuation", () => {
  assert.equal(describePersistenceFailure(new Error("paper writer lease lost")), "paper writer lease lost");
  assert.equal(describePersistenceFailure(Object.assign(new Error("unable to open database file /var/lib/nusa/state.sqlite"), { code: "SQLITE_CANTOPEN" })), "SQLITE_CANTOPEN unable to open database file var lib nusa state.sqlite");
  assert.equal(describePersistenceFailure(new Error('{"token":"abc"}\nsecond line')), "token abc second line");
  assert.equal(describePersistenceFailure("disk I/O error"), "disk I/O error".replace("/", " "));
  assert.equal(describePersistenceFailure(null), "UNKNOWN");
  assert.equal(describePersistenceFailure({}), "UNKNOWN");
  assert.equal(describePersistenceFailure(new Error("x".repeat(500))).length, 90);
  assert.ok(!/[\/\\{}"'<>;=]/.test(describePersistenceFailure(new Error("a/b\\c{d}\"e'f<g>h;i=j"))));
});

test("the runtime appends the cause to the heartbeat error and still uses the stable code elsewhere", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8");
  assert.match(src, /result\.reason === "paper account persistence failed" \? effectivePaperLoop\?\.persistenceFailureDetail\(\)/);
  assert.match(src, /`\$\{result\.reason\}: \$\{detail\}`/);
  assert.match(src, /recordFailure\(detail == null \? \(result\.reason \?\? "PAPER_EXECUTION_FAILED"\)/);
});
