"use strict";
// Isolated invocation from the existing Research service; no timer or broker authority.
process.env.NUSA_RESEARCH_TIMEFRAME = "60m";
const { runPersistedForwardStudy } = require("./lib/regime-forward-receipt");
const { fetchResearchCandles } = require("./research-real-market-run");
runPersistedForwardStudy({ fetchCandles: fetchResearchCandles, stateDb: process.env.NUSA_CLOUD_STATE_DB_PATH }).then(result => {
  const { datasetEvidence, ...summary } = result;
  // Never print raw dataset evidence; the fixed durable receipt retains it.
  console.log("REGIME_FORWARD_STUDY", JSON.stringify(summary));
}).catch(() => { console.error("REGIME_FORWARD_STUDY_FAILED_CLOSED"); process.exitCode = 1; });
