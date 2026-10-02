const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/mobile/src/journalModel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { buildJournal } = shim.exports;

const ev = (id, cycleId, stage, at, extra = {}) => ({ id, cycleId, stage, occurredAt: at, market: "KRW-BTC", status: "PASS", ...extra });

test("journal model is import-free and empty for no events", () => {
  assert.doesNotMatch(source, /^import /m);
  assert.equal(buildJournal([]).length, 0);
});

test("fills, risk holds and halts become entries; quiet cycles collapse into one line; newest first", () => {
  const events = [
    ev("a", "c1", "SIGNAL", 1000), ev("b", "c1", "DECISION", 1100), ev("c", "c2", "SIGNAL", 2000),
    ev("d", "c3", "FILL", 3000, { fill: { side: "BUY", quantity: 0.00008, price: 113970000, fee: 5 } }),
    ev("e", "c4", "RISK", 4000, { status: "FAIL", risk: { status: "FAIL", reason: "하루 손실 한도 근접" } }),
    ev("f", "c5", "HALT", 5000, { reason: "시세 끊김" }),
  ];
  const journal = buildJournal(events);
  assert.deepEqual(journal.map((e) => e.kind), ["halt", "hold", "fill", "quiet"]);
  assert.equal(journal[2].title, "BTC 0.00008 매수 체결");
  assert.match(journal[2].detail, /₩113,970,000/);
  assert.equal(journal[1].detail, "하루 손실 한도 근접");
  assert.equal(journal[3].title, "사이클 2번 동안 대기");
});

test("a failed fill is not reported as a fill, and the list is capped", () => {
  const failed = buildJournal([ev("x", "c1", "FILL", 1, { status: "FAIL", fill: { side: "BUY", quantity: 1, price: 1, fee: 0 } })]);
  assert.ok(failed.every((e) => e.kind !== "fill"));
  const many = Array.from({ length: 20 }, (_, i) => ev(`h${i}`, `c${i}`, "HALT", i));
  assert.equal(buildJournal(many).length, 6);
});

test("HOME renders the journal from the server's read-only PAPER events", () => {
  const home = fs.readFileSync(path.join(root, "apps/mobile/src/homeView.tsx"), "utf8");
  assert.match(home, /const journal = buildJournal\(snapshot\?\.paperLearning\?\.events \?\? \[\]\);/);
  assert.match(home, /testID="home-journal"/);
});
