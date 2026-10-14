import type { ResearchLedgerEntry } from "../../../packages/contracts/src/researchMetaLearning";

/**
 * Policy fields of docs/research-ledger/experiments.json, compiled into the runtime so /health can evaluate meta-learning without
 * reading repository files on the host. tests/research-ledger-snapshot.test.js fails if this drifts from the JSON ledger;
 * regenerate with: node scripts/research-meta-learner.js --emit-snapshot
 */
export const RESEARCH_LEDGER_SNAPSHOT: readonly ResearchLedgerEntry[] = Object.freeze([
  {"id":"SMA_COST_SCREEN_20261008","source":"BACKTEST","dataType":"CLOSE","timeframe":"1m-60m","universe":5,"methodClass":"RULE","configs":5,"discoveryPass":0,"holdoutPass":0},
  {"id":"SMA_60M_OOS_20261012","source":"BACKTEST","dataType":"CLOSE","timeframe":"60m","universe":5,"methodClass":"RULE","configs":9,"discoveryPass":2,"holdoutPass":0},
  {"id":"BREAKOUT_WALKFORWARD_20261013","source":"BACKTEST","dataType":"CLOSE","timeframe":"60m","universe":5,"methodClass":"RULE","configs":6,"discoveryPass":0,"holdoutPass":0},
  {"id":"FAMILY_SCREEN_60M_20261013","source":"BACKTEST","dataType":"CLOSE","timeframe":"60m","universe":5,"methodClass":"RULE","configs":12,"discoveryPass":0,"holdoutPass":0},
  {"id":"DAILY_SCREEN_20261013","source":"BACKTEST","dataType":"CLOSE","timeframe":"1d","universe":5,"methodClass":"RULE","configs":6,"discoveryPass":2,"holdoutPass":0},
  {"id":"STRATEGY_CATALOG_20261013","source":"BACKTEST","dataType":"CLOSE","timeframe":"60m+1d","universe":5,"methodClass":"RULE","configs":97,"discoveryPass":9,"holdoutPass":0},
  {"id":"OHLCV_CATALOG_20261013","source":"BACKTEST","dataType":"OHLCV","timeframe":"60m+1d","universe":5,"methodClass":"RULE","configs":38,"discoveryPass":1,"holdoutPass":0},
  {"id":"BASELINE_PAPER_SHADOW_20261013","source":"PAPER_FORWARD","dataType":"CLOSE","timeframe":"1m","universe":1,"methodClass":"RULE","configs":1,"discoveryPass":0,"holdoutPass":0},
  {"id":"ML_ALLKRW_V1_20261013","source":"BACKTEST","dataType":"OHLCV","timeframe":"60m","universe":106,"methodClass":"ML","configs":3,"discoveryPass":0,"holdoutPass":0,"designFlaw":true},
  {"id":"ML_ALLKRW_V2_20261013","source":"BACKTEST","dataType":"OHLCV","timeframe":"60m","universe":106,"methodClass":"ML","configs":3,"discoveryPass":0,"holdoutPass":0,"retryOf":"ML_ALLKRW_V1_20261013"},
  {"id":"ML_ALLKRW_DAILY_20261013","source":"BACKTEST","dataType":"OHLCV","timeframe":"1d","universe":295,"methodClass":"ML","configs":3,"discoveryPass":0,"holdoutPass":0},
  {"id":"ML_EXTERNAL_DAILY_20261013","source":"BACKTEST","dataType":"EXTERNAL","timeframe":"1d","universe":295,"methodClass":"ML","configs":3,"discoveryPass":0,"holdoutPass":0},
  {"id":"ML_EXTERNAL_60M_20261013","source":"BACKTEST","dataType":"EXTERNAL","timeframe":"60m","universe":106,"methodClass":"ML","configs":3,"discoveryPass":0,"holdoutPass":0},
  {"id":"ML_TRADES_FLOW_15M_20261013","source":"BACKTEST","dataType":"TRADES","timeframe":"15m-60m","universe":30,"methodClass":"ML","configs":3,"discoveryPass":1,"holdoutPass":0},
] as ResearchLedgerEntry[]);
