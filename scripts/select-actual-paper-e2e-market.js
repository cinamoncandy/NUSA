const { upbitTickerToIntelligenceObservation } = require("../dist/apps/cloud/src/upbitTickerObservation.js");
const { decideCio } = require("../dist/apps/cloud/src/cioDecisionEngine.js");

const DEFAULT_MARKET = "KRW-BTC";
const UPBIT_ALL_KRW_TICKERS = "https://api.upbit.com/v1/ticker/all?quote_currencies=KRW";

function asTicker(row) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
  const market = typeof row.market === "string" ? row.market.trim().toUpperCase() : "";
  if (!/^KRW-[A-Z0-9]+$/.test(market)) return null;
  const tradePrice = Number(row.trade_price);
  const signedChangeRate = Number(row.signed_change_rate);
  const turnover = Number(row.acc_trade_price_24h);
  const timestamp = Number(row.timestamp);
  if (!Number.isFinite(tradePrice) || tradePrice <= 0 || !Number.isFinite(signedChangeRate) || !Number.isFinite(turnover) || turnover < 0 || !Number.isSafeInteger(timestamp) || timestamp < 0) return null;
  return {
    type: "ticker",
    code: market,
    trade_price: tradePrice,
    signed_change_rate: signedChangeRate,
    acc_trade_price_24h: turnover,
    acc_trade_volume: Number.isFinite(Number(row.acc_trade_volume_24h)) ? Number(row.acc_trade_volume_24h) : 0,
    trade_timestamp: timestamp,
  };
}

function selectActionablePaperMarket(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error("Upbit all-ticker response must be an array");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("selection clock is invalid");
  const candidates = [];
  for (const row of rows) {
    const ticker = asTicker(row);
    if (ticker == null) continue;
    const observation = upbitTickerToIntelligenceObservation(ticker, { now });
    if (observation == null) continue;
    const decision = decideCio({
      symbol: ticker.code,
      now,
      signals: [{ source: "CHART", score: observation.sentiment, confidence: observation.confidence, observedAt: observation.observedAt, reason: observation.summary }],
      currentAllocation: 0,
      maxAllocation: 0.1,
      maxLeverage: 1,
      risk: "MEDIUM",
      tradingEnabled: true,
    });
    if (decision.action !== "BUY") continue;
    candidates.push({ market: ticker.code, score: decision.score, confidence: decision.confidence, turnover: ticker.acc_trade_price_24h });
  }
  candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || b.turnover - a.turnover || a.market.localeCompare(b.market));
  const selected = candidates[0];
  return selected == null
    ? Object.freeze({ market: DEFAULT_MARKET, status: "NO_NATURALLY_ACTIONABLE_MARKET", actionableCount: 0 })
    : Object.freeze({ market: selected.market, status: "NATURALLY_ACTIONABLE_MARKET", actionableCount: candidates.length, score: selected.score, confidence: selected.confidence });
}

async function selectFromUpbit(request = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await request(UPBIT_ALL_KRW_TICKERS, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Upbit ticker selection unavailable (${response.status})`);
    return selectActionablePaperMarket(await response.json(), Date.now());
  } finally {
    clearTimeout(timer);
  }
}

if (require.main === module) {
  selectFromUpbit().then((selection) => {
    process.stderr.write(`actual PAPER market selection: ${JSON.stringify(selection)}\n`);
    process.stdout.write(`market=${selection.market}\nselection_status=${selection.status}\nactionable_count=${selection.actionableCount}\n`);
  }).catch((error) => {
    process.stderr.write(`actual PAPER market selection unavailable: ${error instanceof Error ? error.message : "unknown error"}; fallback=${DEFAULT_MARKET}\n`);
    process.stdout.write(`market=${DEFAULT_MARKET}\nselection_status=PUBLIC_SELECTION_UNAVAILABLE\nactionable_count=0\n`);
  });
}

module.exports = { DEFAULT_MARKET, asTicker, selectActionablePaperMarket, selectFromUpbit };
