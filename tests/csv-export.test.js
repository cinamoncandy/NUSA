const test = require("node:test");
const assert = require("node:assert/strict");
const { ordersToCsv, equityHistoryToCsv, championEquityHistoryToCsv } = require("../dist/apps/server/src/csvExport.js");

function order(overrides = {}) {
  return Object.freeze({
    id: "o1",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 0.001,
    price: 100_000_000,
    fee: 50,
    filledAt: "2026-01-01T00:00:00.000Z",
    requestedQuantity: 0.001,
    quotedPrice: 100_000_000,
    spreadCost: 10,
    slippageCost: 20,
    marketImpactCost: 0,
    ...overrides
  });
}

test("ordersToCsv: header row matches PaperOrder's own field names", () => {
  const csv = ordersToCsv([]);
  assert.equal(csv, "id,market,side,quantity,price,fee,filledAt,requestedQuantity,quotedPrice,spreadCost,slippageCost,marketImpactCost\r\n");
});

test("ordersToCsv: newest-first input is exported chronologically (oldest first)", () => {
  const csv = ordersToCsv([order({ id: "second" }), order({ id: "first" })]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3, "header + 2 rows");
  assert.ok(lines[1].startsWith("first,"));
  assert.ok(lines[2].startsWith("second,"));
});

test("ordersToCsv: a row's values appear in column order", () => {
  const csv = ordersToCsv([order()]);
  const [, row] = csv.trim().split("\r\n");
  assert.equal(row, "o1,KRW-BTC,BUY,0.001,100000000,50,2026-01-01T00:00:00.000Z,0.001,100000000,10,20,0");
});

test("ordersToCsv: a value containing a comma or quote is quoted and escaped", () => {
  const csv = ordersToCsv([order({ market: 'KRW-BTC, "test"' })]);
  const [, row] = csv.trim().split("\r\n");
  assert.ok(row.includes('"KRW-BTC, ""test"""'));
});

test("equityHistoryToCsv: header and rows include a human-readable ISO timestamp", () => {
  const csv = equityHistoryToCsv([{ timestamp: 1_700_000_000_000, equity: 10_000_000 }]);
  const [header, row] = csv.trim().split("\r\n");
  assert.equal(header, "timestamp,isoTime,equity");
  assert.equal(row, `1700000000000,${new Date(1_700_000_000_000).toISOString()},10000000`);
});

test("equityHistoryToCsv: empty history is just the header row", () => {
  assert.equal(equityHistoryToCsv([]), "timestamp,isoTime,equity\r\n");
});

test("championEquityHistoryToCsv: one equity column per challenger, aligned by shared tick timestamp", () => {
  const csv = championEquityHistoryToCsv([
    { id: "a", label: "SMA(5,20)", history: [{ timestamp: 1, equity: 10_000_000 }, { timestamp: 2, equity: 10_100_000 }] },
    { id: "b", label: "EMA(5,20)", history: [{ timestamp: 1, equity: 9_900_000 }, { timestamp: 2, equity: 9_950_000 }] }
  ]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3, "header + 2 aligned rows");
  assert.equal(lines[0], 'timestamp,isoTime,"SMA(5,20)","EMA(5,20)"');
  assert.equal(lines[1], `1,${new Date(1).toISOString()},10000000,9900000`);
  assert.equal(lines[2], `2,${new Date(2).toISOString()},10100000,9950000`);
});

test("championEquityHistoryToCsv: no challenger has ticked yet -> header-only", () => {
  const csv = championEquityHistoryToCsv([
    { id: "a", label: "SMA(5,20)", history: [] },
    { id: "b", label: "EMA(5,20)", history: [] }
  ]);
  assert.equal(csv, 'timestamp,isoTime,"SMA(5,20)","EMA(5,20)"\r\n');
});

test("championEquityHistoryToCsv: no challengers at all -> just timestamp/isoTime header", () => {
  assert.equal(championEquityHistoryToCsv([]), "timestamp,isoTime\r\n");
});
