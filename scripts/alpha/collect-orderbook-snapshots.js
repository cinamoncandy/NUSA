"use strict";
/**
 * Collects public Upbit order books into the `OrderbookSnapshot` shape the imbalance feature
 * already expects, one JSON object per line.
 *
 * This exists because order-book depth cannot be backtested from history: Upbit publishes the
 * current book and no archive of it, so the only way to obtain a dataset is to record one going
 * forward. Public market data only -- no credential is read, sent, or required.
 *
 *   node scripts/alpha/collect-orderbook-snapshots.js --market KRW-BTC --seconds 600 --out data.jsonl
 */
const { appendFileSync, existsSync } = require("node:fs");
const { setTimeout: sleep } = require("node:timers/promises");

const ENDPOINT = "https://api.upbit.com/v1/orderbook";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

/** Upbit's units are already sorted best-first; the feature reads them in that order. */
function toSnapshot(entry, market, sequence) {
  const units = Array.isArray(entry.orderbook_units) ? entry.orderbook_units : [];
  if (units.length === 0) return undefined;
  const capturedAt = new Date(entry.timestamp).toISOString();
  return {
    snapshotId: `${market}:${entry.timestamp}`,
    market,
    capturedAt,
    bids: units.map((unit) => ({ price: unit.bid_price, quantity: unit.bid_size })),
    asks: units.map((unit) => ({ price: unit.ask_price, quantity: unit.ask_size })),
    sequence,
    source: "UPBIT_PUBLIC_ORDERBOOK"
  };
}

async function main() {
  const market = argument("market", "KRW-BTC");
  const seconds = Number(argument("seconds", "120"));
  const intervalMs = Number(argument("interval-ms", "1000"));
  const out = argument("out", `orderbook-${market}.jsonl`);
  if (!/^KRW-[A-Z0-9]+$/.test(market)) throw new Error("market must look like KRW-BTC");
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--seconds must be positive");
  if (!Number.isFinite(intervalMs) || intervalMs < 200) throw new Error("--interval-ms must be >= 200");
  if (existsSync(out)) throw new Error(`${out} already exists; refusing to append to an existing dataset`);

  const deadline = Date.now() + seconds * 1000;
  let written = 0;
  let lastTimestamp = null;
  let sequence = 0;
  let failures = 0;
  let regressed = 0;

  while (Date.now() < deadline) {
    const started = Date.now();
    try {
      const response = await fetch(`${ENDPOINT}?markets=${encodeURIComponent(market)}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const entry = Array.isArray(body) ? body[0] : undefined;
      // The endpoint returns the same book until it changes; recording duplicates would
      // manufacture snapshots the market never produced.
      // Upbit occasionally serves a book older than the one just returned -- observed at roughly
      // 5% of polls. Such a snapshot is DROPPED rather than reordered: sorting it into place
      // would manufacture a sequence the market never presented, and a live strategy reading
      // the feed in arrival order would never have acted on it either.
      if (entry != null && lastTimestamp != null && entry.timestamp < lastTimestamp) {
        regressed += 1;
      } else if (entry != null && entry.timestamp !== lastTimestamp) {
        const snapshot = toSnapshot(entry, market, sequence);
        if (snapshot != null) {
          appendFileSync(out, `${JSON.stringify(snapshot)}\n`, "utf8");
          lastTimestamp = entry.timestamp;
          sequence += 1;
          written += 1;
        }
      }
    } catch (error) {
      failures += 1;
      if (failures > 20) throw new Error(`too many collection failures: ${error instanceof Error ? error.message : "unknown"}`);
    }
    const elapsed = Date.now() - started;
    if (elapsed < intervalMs) await sleep(intervalMs - elapsed);
  }

  console.log(JSON.stringify({ status: "COLLECTED", market, out, snapshots: written, regressed, failures, seconds }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
