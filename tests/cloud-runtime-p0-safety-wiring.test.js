const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimeSource = () => fs.readFileSync(path.join(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");

test("cloud PAPER runtime reads durable P0 evidence before evaluating an execution tick", () => {
  const source = runtimeSource();
  assert.match(source, /new SqliteP0AlertRepository\(durableRepository\.database\(\)\)/);

  const tickerSection = source.indexOf("if (effectivePaperLoop != null && state != null)");
  const p0Read = source.indexOf("effectiveP0AlertRepository?.readState().openP0", tickerSection);
  const openP0Block = source.indexOf("if (openP0) return;", p0Read);
  const processTick = source.indexOf("effectivePaperLoop.processTick", tickerSection);

  assert.ok(tickerSection >= 0, "paper runtime ticker branch must exist");
  assert.ok(p0Read > tickerSection, "durable P0 state must be read inside the paper runtime ticker branch");
  assert.ok(openP0Block > p0Read, "an open P0 must block the runtime path");
  assert.ok(processTick > openP0Block, "P0 blocking must happen before processTick can evaluate an order");
});

test("corrupt P0 evidence fails closed and PAPER operations projects HALTED for open or unreadable P0 state", () => {
  const source = runtimeSource();
  const tickerSection = source.indexOf("if (effectivePaperLoop != null && state != null)");
  const p0Read = source.indexOf("effectiveP0AlertRepository?.readState().openP0", tickerSection);
  const failClosedClear = source.indexOf("effectiveProvider.clear();", p0Read);
  const failClosedReturn = source.indexOf("return;", failClosedClear);
  const processTick = source.indexOf("effectivePaperLoop.processTick", tickerSection);

  assert.ok(failClosedClear > p0Read && failClosedReturn > failClosedClear && processTick > failClosedReturn,
    "unreadable P0 evidence must clear the runtime projection and return before processTick");

  const operationsSection = source.indexOf("loadPaperOperations:");
  const operationsP0Read = source.indexOf("effectiveP0AlertRepository?.readState().openP0", operationsSection);
  const unknownBecomesOpen = source.indexOf("openP0 = true;", operationsP0Read);
  const haltedProjection = source.indexOf("dashboard.mode === \"FAULTED\" || dashboard.killSwitchActive || openP0", operationsP0Read);

  assert.ok(operationsP0Read > operationsSection, "operations status must read durable P0 state");
  assert.ok(unknownBecomesOpen > operationsP0Read, "unreadable P0 state must be treated as open");
  assert.ok(haltedProjection > unknownBecomesOpen, "open or unreadable P0 state must project HALTED");
});
