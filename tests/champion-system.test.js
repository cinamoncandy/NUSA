const test = require("node:test");
const assert = require("node:assert/strict");
const { ChampionChallengerSystem, CHAMPION_CHALLENGER_PRESETS } = require("../dist/apps/server/src/championSystem.js");

const MARKET = "KRW-BTC";
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };

function newSystem() {
  return new ChampionChallengerSystem(MARKET, 10_000_000, 0.0005, RISK_POLICY, FILL_MODEL);
}

test("CHAMPION_CHALLENGER_PRESETS is a fixed, distinct set", () => {
  assert.equal(CHAMPION_CHALLENGER_PRESETS.length, 3);
  const ids = CHAMPION_CHALLENGER_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("before any ticks, every challenger starts flat with the full initial cash", () => {
  const system = newSystem();
  const standings = system.getStandings("sma-crossover", { shortPeriod: 5, longPeriod: 20 }, 100_000_000);
  assert.equal(standings.challengers.length, 3);
  for (const challenger of standings.challengers) {
    assert.equal(challenger.account.cash, 10_000_000);
    assert.equal(challenger.account.position.quantity, 0);
    assert.equal(challenger.stats.totalTrades, 0);
  }
});

test("championId matches the preset equal to the real active (choice, periods); null when it doesn't match any preset", () => {
  const system = newSystem();
  const matching = system.getStandings("sma-crossover", { shortPeriod: 5, longPeriod: 20 }, 100_000_000);
  assert.equal(matching.championId, "sma-5-20");
  assert.ok(matching.challengers.find((c) => c.id === "sma-5-20").isChampion);
  assert.equal(matching.challengers.filter((c) => c.isChampion).length, 1);

  const custom = system.getStandings("sma-crossover", { shortPeriod: 7, longPeriod: 21 }, 100_000_000);
  assert.equal(custom.championId, null);
  assert.ok(custom.challengers.every((c) => !c.isChampion));
});

test("a real BUY-then-SELL price crossover drives an actual shadow trade for the matching preset", () => {
  const system = newSystem();
  // SMA(5,20) warms up on 20 samples; a flat run followed by a sharp rise crosses short above
  // long (BUY), then a sharp fall crosses back (SELL) -- exercises both branches for real.
  const flat = Array.from({ length: 20 }, () => 100_000_000);
  const rising = [110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000, 135_000_000];
  const falling = [125_000_000, 120_000_000, 110_000_000, 100_000_000, 90_000_000, 80_000_000];
  let t = 0;
  for (const price of [...flat, ...rising, ...falling]) {
    system.onCandleUpdate(MARKET, price, ++t);
  }
  const standings = system.getStandings("sma-crossover", { shortPeriod: 5, longPeriod: 20 }, 80_000_000);
  const sma5x20 = standings.challengers.find((c) => c.id === "sma-5-20");
  assert.ok(sma5x20.stats.totalTrades > 0, "expected at least one shadow BUY to have fired");
});

test("shadow trading never touches a real broker -- two independent systems produce independent state", () => {
  const systemA = newSystem();
  const systemB = newSystem();
  // Same flat-then-rising pattern as the crossover test above -- a monotonic ramp from tick 0
  // never actually crosses (the short/long spread is already positive throughout warmup), so
  // a flat baseline is needed to get a real zero-crossing BUY signal.
  const flat = Array.from({ length: 20 }, () => 100_000_000);
  const rising = [110_000_000, 115_000_000, 120_000_000, 125_000_000, 130_000_000];
  let t = 0;
  for (const price of [...flat, ...rising]) systemA.onCandleUpdate(MARKET, price, ++t);
  const standingsA = systemA.getStandings("sma-crossover", { shortPeriod: 5, longPeriod: 20 }, 130_000_000);
  const standingsB = systemB.getStandings("sma-crossover", { shortPeriod: 5, longPeriod: 20 }, 100_000_000);
  const tradedA = standingsA.challengers.some((c) => c.stats.totalTrades > 0);
  const flatB = standingsB.challengers.every((c) => c.stats.totalTrades === 0 && c.account.cash === 10_000_000);
  assert.ok(tradedA, "system A (fed ticks) should have traded");
  assert.ok(flatB, "system B (fed nothing) must remain untouched");
});
