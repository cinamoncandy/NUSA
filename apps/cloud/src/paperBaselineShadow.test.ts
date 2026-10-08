import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PaperBaselineShadow, decodeBaselineShadow } from "./paperBaselineShadow";
import { baselineShadowRecordPath, readBaselineShadowRecord, writeBaselineShadowRecord } from "./paperBaselineShadowRecord";
import { ownerBaselineStrategySpec } from "./ownerBaselinePaperStrategy";

const spec = ownerBaselineStrategySpec("a".repeat(40));
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 8, 0, 0, 0);
/** Strictly ascending minute closes from a price function. */
const bars = (count: number, price: (index: number) => number, from = 0): Array<readonly [number, number]> => Array.from({ length: count }, (_, index) => [T0 + (from + index) * MINUTE, price(from + index)] as const);
const make = (restore?: ReturnType<typeof decodeBaselineShadow>) => new PaperBaselineShadow({ spec, feeRate: 0.0005, now: () => 1_000, ...(restore === undefined ? {} : { restore }) });
const feed = (shadow: PaperBaselineShadow, all: ReadonlyArray<readonly [number, number]>): void => { for (let end = 1; end <= all.length; end += 1) shadow.observe("KRW-XRP", all.slice(Math.max(0, end - 60), end)); };

// Rises for 30 minutes (BUY), falls for 30 minutes (SELL): exactly one round trip.
const roundTrip = (index: number): number => 1000 + (index < 30 ? index : 60 - index) * 2;

test("a rise then a fall makes exactly one hypothetical round trip with fee drag", () => {
  const shadow = make();
  feed(shadow, bars(70, roundTrip));
  const totals = shadow.summary();
  assert.equal(totals.trades, 1);
  assert.ok(totals.feeBp >= 9 && totals.feeBp <= 11, `round-trip fee drag is about 10 bp, got ${totals.feeBp}`);
  assert.ok(totals.since > 0);
  assert.equal(totals.wins + (totals.trades - totals.wins), 1);
});

test("feeding the same bars again changes nothing, and bars are never counted twice", () => {
  const all = bars(70, roundTrip);
  const shadow = make();
  feed(shadow, all);
  const first = shadow.summary();
  feed(shadow, all);
  assert.deepEqual(shadow.summary(), first);
});

test("a flat market makes no trade, and malformed or out-of-order bars are ignored without throwing", () => {
  const shadow = make();
  feed(shadow, bars(80, () => 1000));
  assert.equal(shadow.summary().trades, 0);
  assert.doesNotThrow(() => shadow.observe("KRW-XRP", [[Number.NaN, 5], [T0, -1], [T0 + MINUTE, Number.POSITIVE_INFINITY]] as never));
  assert.doesNotThrow(() => shadow.observe("not-a-market", bars(30, (i) => 1000 + i)));
  assert.equal(shadow.summary().trades, 0);
});

test("restart: totals and last processed bars are restored, old bars are not replayed, and the dropped position re-opens on the next BUY bar", () => {
  const all = bars(70, roundTrip);
  const uninterrupted = make();
  feed(uninterrupted, all);
  assert.equal(uninterrupted.summary().grossGainBp, Math.round((roundTrip(38) / roundTrip(21) - 1) * 10_000), "enters at the first BUY bar and exits at the first SELL bar");
  const first = make();
  feed(first, all.slice(0, 30)); // a position is open, nothing closed yet
  assert.equal(first.summary().trades, 0);
  const saved = first.takePersistable();
  assert.ok(saved);
  const restored = make(decodeBaselineShadow(JSON.parse(JSON.stringify(saved))));
  feed(restored, all.slice(0, 30));
  assert.equal(restored.summary().trades, 0, "already processed bars are skipped");
  feed(restored, all);
  // The open position was dropped by the restart, so the shadow re-enters at the first NEW BUY bar (index 30) instead of the original entry.
  assert.equal(restored.summary().trades, 1);
  assert.equal(restored.summary().grossLossBp, Math.round((1 - roundTrip(38) / roundTrip(30)) * 10_000));
  assert.equal(restored.summary().since, 1_000, "since is kept from the first run");
  assert.equal(first.takePersistable(), undefined, "nothing changed since the last take");
});

test("decode rejects malformed persisted state", () => {
  const good = { schemaVersion: 1, totals: { since: 1, trades: 2, wins: 1, grossGainBp: 3, grossLossBp: 4, feeBp: 20 }, lastBarMinute: { "KRW-XRP": 5 } };
  assert.ok(decodeBaselineShadow(good));
  assert.equal(decodeBaselineShadow({ ...good, schemaVersion: 2 }), undefined);
  assert.equal(decodeBaselineShadow({ ...good, totals: { ...good.totals, wins: 3 } }), undefined, "wins cannot exceed trades");
  assert.equal(decodeBaselineShadow({ ...good, totals: { ...good.totals, feeBp: -1 } }), undefined);
  assert.equal(decodeBaselineShadow({ ...good, lastBarMinute: { "xrp": 5 } }), undefined);
  assert.equal(decodeBaselineShadow({ ...good, totals: { ...good.totals, since: 0 } }), undefined, "since 0 with processed bars is inconsistent");
  assert.equal(decodeBaselineShadow({ ...good, lastBarMinute: {} }), undefined, "a started shadow must have processed a minute");
  assert.equal(decodeBaselineShadow({ ...good, totals: { since: 0, trades: 0, wins: 0, grossGainBp: 0, grossLossBp: 0, feeBp: 0 }, lastBarMinute: {} })?.totals.trades, 0, "a fresh shadow is consistent");
  assert.equal(decodeBaselineShadow({ ...good, totals: { ...good.totals, trades: 0, wins: 0 } }), undefined, "no trades but non-zero totals is impossible");
  assert.equal(decodeBaselineShadow({ ...good, totals: { since: 1, trades: 0, wins: 0, grossGainBp: 100, grossLossBp: 0, feeBp: 0 } }), undefined);
  assert.equal(decodeBaselineShadow(null), undefined);
});

test("the record file round-trips, reports failure honestly, and ignores memory, relative and corrupt locations", () => {
  const db = path.join(mkdtempSync(path.join(tmpdir(), "nusa-shadow-")), "cloud-state.sqlite");
  const shadow = make();
  feed(shadow, bars(70, roundTrip));
  const persisted = shadow.takePersistable()!;
  assert.equal(readBaselineShadowRecord(db), undefined);
  assert.equal(writeBaselineShadowRecord(db, persisted), true);
  assert.deepEqual(readBaselineShadowRecord(db), persisted);
  assert.equal(writeBaselineShadowRecord(":memory:", persisted), false);
  assert.equal(writeBaselineShadowRecord("/nonexistent-directory-nusa/cloud-state.sqlite", persisted), false);
  assert.equal(baselineShadowRecordPath("relative.sqlite"), undefined);
  writeFileSync(baselineShadowRecordPath(db)!, "{not json");
  assert.equal(readBaselineShadowRecord(db), undefined);
});

test("on the frozen public-candle data the shadow reproduces the offline replay trade counts", () => {
  const data = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/research-data/2026-10-08-upbit-1m-closes.json"), "utf8")) as Record<string, Array<[number, number]>>;
  // Offline replay (scripts/offline-sma-cost-screen.js): XRP 133, ETH 149, SOL 141, DOGE 260 round trips; BTC 133 (shadow 132: one score rounds to zero).
  const expected: Record<string, number> = { "KRW-XRP": 133, "KRW-ETH": 149, "KRW-SOL": 141, "KRW-DOGE": 260, "KRW-BTC": 133 };
  for (const [market, trades] of Object.entries(expected)) {
    const shadow = make();
    const candles = data[market]!;
    for (let end = 1; end <= candles.length; end += 1) shadow.observe(market, candles.slice(Math.max(0, end - 60), end));
    assert.ok(Math.abs(shadow.summary().trades - trades) <= 1, `${market}: shadow ${shadow.summary().trades} vs replay ${trades}`);
  }
});

test("a late revision of an already completed minute is not a new bar", () => {
  const rising = bars(40, (index) => 1000 + index * 2); // BUY from the 22nd bar, no SELL yet
  const shadow = make();
  feed(shadow, rising);
  const before = shadow.takePersistable();
  // The last completed minute is re-read with a later closing tick and a lower price, as a late ticker would produce.
  const revised = [...rising.slice(0, -1), [rising[rising.length - 1]![0] + 30_000, 900] as const];
  shadow.observe("KRW-XRP", revised.slice(-60));
  assert.equal(shadow.summary().trades, 0, "no spurious SELL from a revised close of the same minute");
  assert.equal(shadow.takePersistable(), undefined, "nothing was processed, so nothing changed");
  assert.deepEqual(before?.lastBarMinute, { "KRW-XRP": Math.floor(rising[rising.length - 1]![0] / MINUTE) });
});

test("a winner below half a basis point is still a win, and only the published totals are rounded", () => {
  const shadow = make() as unknown as { settle(entry: number, exit: number): void; summary(): { trades: number; wins: number; grossGainBp: number; feeBp: number } };
  shadow.settle(1000, 1001.0008); // about +10 bp gross, about +0.003 bp after the 0.05% fee per side
  const totals = shadow.summary();
  assert.equal(totals.trades, 1);
  assert.equal(totals.wins, 1, "positive after-fee return is a win even though it rounds to 0 bp");
  assert.ok(totals.grossGainBp >= 9 && totals.grossGainBp <= 11);
});
