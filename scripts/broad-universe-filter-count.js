"use strict";
/**
 * Broad-universe step 2b: tradability filter COUNT (design section 4 / metadata note "Next 1").
 * Inputs: the committed metadata file and public DAILY candles of the discovery window.
 * Only price LEVEL and quote traded value are used (medians); no return is computed.
 * Output: counts and passing market codes only; no price or volume value is printed or written.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const WINDOW_FROM = "2021-12-20";
const WINDOW_TO_EXCLUSIVE = "2023-07-01";
const DEFAULT_TICK_BP_MAX = 10;
const VALUE_MIN_KRW = 1e9;
const LISTING_WAIT_DAYS = 30;
const MIN_DAYS = 30;
const PEGGED = ["USDT", "USDC", "USD1", "PYUSD", "EURC", "XAUT"];
const STUDY = ["KRW-BTC", "KRW-ETH", "KRW-SOL", "KRW-NEAR", "KRW-XRP", "KRW-DOGE"];
const DAY = 86400000;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 429) { await sleep(1000 * attempt); continue; }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json();
    } catch (e) { if (attempt === 6) throw e; await sleep(500 * attempt); }
  }
  throw new Error("RETRIES_EXHAUSTED");
}

/** Tier table read from the committed file: tick -> lowest current price seen with that tick. */
function buildTiers(markets, prices) {
  const lowest = new Map(); const highest = new Map();
  for (const m of markets) {
    const p = prices[m.market]; if (!(p > 0)) continue;
    const t = Number(m.tickSize);
    lowest.set(t, Math.min(lowest.get(t) ?? Infinity, p));
    highest.set(t, Math.max(highest.get(t) ?? 0, p));
  }
  return { lowest, highest };
}
function tickAt(price, tiers, rule) {
  const ticks = [...tiers.lowest.keys()].sort((a, b) => a - b);
  let chosen = ticks[0];
  for (const t of ticks) {
    // rule "low": boundary = lowest price seen with the higher tick; rule "high": highest price seen with the lower tick
    const boundary = rule === "low" ? tiers.lowest.get(t) : (ticks.indexOf(t) === 0 ? 0 : tiers.highest.get(ticks[ticks.indexOf(t) - 1]));
    if (price >= boundary) chosen = t;
  }
  return chosen;
}

/** Arguments: [outPath] [--tick-bp N | --tick-bp=N] in any order; unknown flags, a second path or a bad number fail loudly. */
function parseArgs(argv) {
  let tickBp = DEFAULT_TICK_BP_MAX; let outPath;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--tick-bp" || a.startsWith("--tick-bp=")) {
      const raw = a === "--tick-bp" ? argv[i + 1] : a.slice("--tick-bp=".length);
      if (a === "--tick-bp") i += 1;
      if (raw === undefined || !/^\d+(\.\d+)?$/.test(raw)) throw new Error("--tick-bp needs a plain decimal number");
      tickBp = Number(raw);
      if (!(tickBp > 0 && tickBp <= 100)) throw new Error("--tick-bp must be a number in (0, 100]");
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a.split("=")[0]}`);
    else if (outPath === undefined) outPath = a;
    else throw new Error("only one output path is allowed");
  }
  return { tickBp, outPath };
}

async function main() {
  const { tickBp: TICK_BP_MAX, outPath } = parseArgs(process.argv.slice(2));
  const metaPath = path.join(__dirname, "..", "docs", "research-data", "broad-universe-market-metadata-2026-11-24.json");
  const raw = fs.readFileSync(metaPath);
  const metaSha = crypto.createHash("sha256").update(raw).digest("hex");
  const meta = JSON.parse(raw);
  const markets = meta.markets;
  const prices = {};
  for (let i = 0; i < markets.length; i += 100) {
    const codes = markets.slice(i, i + 100).map((m) => m.market).join(",");
    for (const t of await getJson(`https://api.upbit.com/v1/ticker?markets=${codes}`)) prices[t.market] = t.trade_price;
    await sleep(150);
  }
  const tiers = buildTiers(markets, prices);
  const tickerSnapshotSha256 = crypto.createHash("sha256").update(JSON.stringify(Object.keys(prices).sort().map((k) => [k, prices[k]]))).digest("hex");
  const tierTable = [...tiers.lowest.keys()].sort((a, b) => a - b).map((t) => ({ tick: t, lowestCurrentPrice: tiers.lowest.get(t), highestCurrentPrice: tiers.highest.get(t) }));
  const results = [];
  for (const m of markets) {
    const rows = [];
    let to = `${WINDOW_TO_EXCLUSIVE}T00:00:00Z`;
    for (let page = 0; page < 4; page += 1) {
      const batch = await getJson(`https://api.upbit.com/v1/candles/days?market=${m.market}&count=200&to=${encodeURIComponent(to)}`);
      await sleep(130);
      if (!batch.length) break;
      rows.push(...batch);
      const oldest = batch[batch.length - 1].candle_date_time_utc;
      if (oldest.slice(0, 10) <= WINDOW_FROM || batch.length < 200) break;
      to = `${oldest}Z`;
    }
    const inWindow = rows.filter((r) => { const d = r.candle_date_time_utc.slice(0, 10); return d >= WINDOW_FROM && d < WINDOW_TO_EXCLUSIVE; })
      .sort((a, b) => a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
    if (!inWindow.length) { results.push({ market: m.market, listedInWindow: false, days: 0 }); continue; }
    const first = Date.parse(`${inWindow[0].candle_date_time_utc.slice(0, 10)}T00:00:00Z`);
    const listedDuring = first > Date.parse(`${WINDOW_FROM}T00:00:00Z`) + DAY;
    const startMs = listedDuring ? first + LISTING_WAIT_DAYS * DAY : first;
    const used = inWindow.filter((r) => Date.parse(`${r.candle_date_time_utc.slice(0, 10)}T00:00:00Z`) >= startMs);
    if (used.length < MIN_DAYS) { results.push({ market: m.market, days: used.length }); continue; }
    const medClose = median(used.map((r) => r.trade_price));
    const medValue = median(used.map((r) => r.candle_acc_trade_price));
    const bp = (rule) => (tickAt(medClose, tiers, rule) / medClose) * 1e4;
    results.push({ market: m.market, days: used.length, tickOk: bp("low") <= TICK_BP_MAX, tickOkAlt: bp("high") <= TICK_BP_MAX, valueOk: medValue >= VALUE_MIN_KRW });
  }
  const sym = (c) => c.replace("KRW-", "");
  const eligible = results.filter((r) => r.days >= MIN_DAYS);
  const pegged = (c) => PEGGED.includes(sym(c));
  const warn = new Set(markets.filter((m) => m.warning).map((m) => m.market));
  const pass = (r) => r.tickOk && r.valueOk;
  const passAlt = (r) => r.tickOkAlt && r.valueOk;
  const discovery = eligible.filter((r) => pass(r) && !pegged(r.market));
  const forward = discovery.filter((r) => !STUDY.includes(r.market) && !warn.has(r.market));
  const forwardAlt = eligible.filter((r) => passAlt(r) && !pegged(r.market) && !STUDY.includes(r.market) && !warn.has(r.market));
  const out = {
    kind: "BROAD_UNIVERSE_FILTER_COUNT",
    window: [WINDOW_FROM, WINDOW_TO_EXCLUSIVE],
    metadataSha256: metaSha,
    tickerSnapshotSha256,
    tierTable,
    rules: { tickBpMax: TICK_BP_MAX, tickBpDefault: DEFAULT_TICK_BP_MAX, medianDailyValueMinKrw: VALUE_MIN_KRW, listingWaitDays: LISTING_WAIT_DAYS, minDays: MIN_DAYS, tickBoundary: "lowest current price seen with the higher tick (alt: highest price seen with the lower tick)" },
    counts: {
      marketsInFile: markets.length,
      withEnoughWindowDays: eligible.length,
      passTick: eligible.filter((r) => r.tickOk).length,
      passValue: eligible.filter((r) => r.valueOk).length,
      passBoth: eligible.filter(pass).length,
      discoveryPoolAfterPegged: discovery.length,
      forwardPoolAfterStudyAndWarning: forward.length,
      forwardPoolAltTickBoundary: forwardAlt.length,
      gateAtLeast40: forward.length >= 40,
      gateStrictAtLeast40: forwardAlt.length >= 40, // the looser-bar pre-registration gates on the strict tick boundary
    },
    discoveryPool: discovery.map((r) => r.market).sort(),
    forwardPool: forward.map((r) => r.market).sort(),
  };
  if (outPath) fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out.counts));
}
if (require.main === module) main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
module.exports = { median, buildTiers, tickAt, parseArgs };
