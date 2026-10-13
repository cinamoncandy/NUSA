#!/usr/bin/env node
"use strict";
/**
 * Research meta-learner (WO-RESEARCH-20261013-META-LEARNER): learns from the research ledger which ways of learning have
 * failed, and chooses the next experiment by a fixed policy. Read-only; it never runs an experiment, never changes a pass
 * rule, threshold, holdout or risk setting, and never grants authority. It only orders what to try next.
 *
 * Fixed policy (committed with this file):
 * 1. Lessons: per dimension value (dataType, timeframe class, universe class, methodClass) count experiments, configurations,
 *    discovery passes and holdout passes, and the overfit rate = discovery passes that failed the holdout / discovery passes.
 * 2. A dimension value is EXHAUSTED when it has >= 50 configurations and 0 holdout passes.
 * 3. Candidates are every combination of the known dimension values. A candidate is eligible only if it differs from every
 *    tried combination and contains no EXHAUSTED value in a dimension that has a non-exhausted alternative.
 * 4. Score = number of values the candidate takes that have never been tried (exploration), minus a fixed cost per value that
 *    needs new collection before it can be tested (ORDERBOOK, TRADES, EXTERNAL: 2; ALL_KRW universe: 0; ML: 0).
 *    Ties are broken by the fixed order of the arrays below. Values needing collection are reported as prerequisites.
 * 4b. Live PAPER/SHADOW outcomes (source PAPER_FORWARD) are ledger entries like any experiment, so the meta-learner learns from
 *    real execution as well as from backtests (the loop's "failure analysis -> learning-method evaluation" edge).
 * 4c. An experiment recorded with designFlaw: true failed because of how it was built, not because the idea was tested. Its
 *    combination may be re-tried ONCE with the flaw fixed (a retry records retryOf). Its configurations still count in the
 *    cumulative bar, so a retry is never free. Added 2026-10-13 after ML_ALLKRW_V1, before its retry was run.
 * 5. The bar for the next experiment is cumulative: alpha = 0.05 / (all configurations so far + the next experiment's).
 *    Learning more ways to learn makes every later test stricter, so trying many methods cannot buy a lucky pass.
 */
const fs = require("node:fs");
const path = require("node:path");

const LEDGER = path.join(__dirname, "..", "docs", "research-ledger", "experiments.json");
const DIMENSIONS = {
  dataType: ["CLOSE", "OHLCV", "TRADES", "ORDERBOOK", "EXTERNAL"],
  timeframe: ["INTRADAY", "DAILY"],
  universe: ["FIVE", "ALL_KRW"],
  methodClass: ["RULE", "ML"],
};
// EXTERNAL history (Coinbase public candles, ECB USD/KRW via frankfurter.dev) was verified reachable on 2026-10-13, so it needs no
// collection before a backtest (Binance and Bybit answer 451/403 from this environment). TRADES and ORDERBOOK history is not offered.
const COLLECTION_COST = { TRADES: 2, ORDERBOOK: 2, EXTERNAL: 0 };
const EXHAUSTED_CONFIGS = 50;

function classify(e) {
  const tf = e.timeframe.includes("1d") && !/m/.test(e.timeframe.replace("1d", "")) ? ["DAILY"] : e.timeframe.includes("1d") ? ["INTRADAY", "DAILY"] : ["INTRADAY"];
  return { dataType: [e.dataType], timeframe: tf, universe: [e.universe <= 5 ? "FIVE" : "ALL_KRW"], methodClass: [e.methodClass] };
}

const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
const experiments = ledger.experiments;
const stats = {};
for (const [dim, values] of Object.entries(DIMENSIONS)) for (const v of values) stats[`${dim}=${v}`] = { experiments: 0, configs: 0, discovery: 0, holdout: 0 };
const tried = new Set();
for (const e of experiments) {
  const c = classify(e);
  for (const [dim, values] of Object.entries(c)) for (const v of values) {
    const s = stats[`${dim}=${v}`];
    s.experiments += 1; s.configs += e.configs; s.discovery += e.discoveryPass; s.holdout += e.holdoutPass;
  }
  const retried = experiments.some((other) => other.retryOf === e.id);
  if (e.designFlaw === true && !retried) continue; // re-triable once: not marked as tried
  for (const dt of c.dataType) for (const tf of c.timeframe) for (const u of c.universe) for (const m of c.methodClass) tried.add([dt, tf, u, m].join("|"));
}
const exhausted = (key) => stats[key].configs >= EXHAUSTED_CONFIGS && stats[key].holdout === 0;
const totalConfigs = experiments.reduce((a, e) => a + e.configs, 0);
const totalDiscovery = experiments.reduce((a, e) => a + e.discoveryPass, 0);
const totalHoldout = experiments.reduce((a, e) => a + e.holdoutPass, 0);

console.log(`LEDGER: ${experiments.length} experiments, ${totalConfigs} configurations, ${totalDiscovery} discovery passes, ${totalHoldout} holdout passes`);
const forward = experiments.filter((e) => e.source === "PAPER_FORWARD");
console.log(`live PAPER/SHADOW evidence: ${forward.length} entr${forward.length === 1 ? "y" : "ies"}, ${forward.reduce((a, e) => a + e.holdoutPass, 0)} passes (forward evidence is unseen data by construction)`);
console.log(`overall overfit rate: ${totalDiscovery ? (((totalDiscovery - totalHoldout) / totalDiscovery) * 100).toFixed(0) : "n/a"}% of discovery passes failed on unseen data`);
console.log("\nLESSONS (dimension value | experiments | configurations | discovery | holdout | status)");
for (const [key, s] of Object.entries(stats)) console.log(`${key} | ${s.experiments} | ${s.configs} | ${s.discovery} | ${s.holdout} | ${s.experiments === 0 ? "UNTRIED" : exhausted(key) ? "EXHAUSTED" : "OPEN"}`);

const candidates = [];
for (const dt of DIMENSIONS.dataType) for (const tf of DIMENSIONS.timeframe) for (const u of DIMENSIONS.universe) for (const m of DIMENSIONS.methodClass) {
  const combo = { dataType: dt, timeframe: tf, universe: u, methodClass: m };
  if (tried.has([dt, tf, u, m].join("|"))) continue;
  const blocked = Object.entries(combo).some(([dim, v]) => exhausted(`${dim}=${v}`) && DIMENSIONS[dim].some((alt) => !exhausted(`${dim}=${alt}`)));
  if (blocked) continue;
  const novelty = Object.entries(combo).filter(([dim, v]) => stats[`${dim}=${v}`].experiments === 0).length;
  const cost = Object.values(combo).reduce((a, v) => a + (COLLECTION_COST[v] ?? 0), 0);
  const prerequisites = Object.values(combo).filter((v) => COLLECTION_COST[v]).map((v) => `collect ${v}`);
  candidates.push({ combo, score: novelty - cost, novelty, cost, prerequisites });
}
candidates.sort((a, b) => b.score - a.score);
console.log("\nNEXT EXPERIMENTS (score = novelty - collection cost)");
for (const c of candidates.slice(0, 6)) console.log(`${Object.values(c.combo).join(" + ")} | score ${c.score} (novelty ${c.novelty}, cost ${c.cost})${c.prerequisites.length ? ` | needs: ${c.prerequisites.join(", ")}` : ""}`);
const next = candidates[0];
console.log(`\nRECOMMENDED: ${next ? Object.values(next.combo).join(" + ") : "none"}`);
for (const n of [1, 3, 10]) console.log(`holdout bar if the next experiment evaluates ${n} configuration(s): p < ${(0.05 / (totalConfigs + n)).toExponential(2)}`);
