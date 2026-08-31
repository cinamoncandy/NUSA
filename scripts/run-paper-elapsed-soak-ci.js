const { join } = require("node:path");
const { run } = require("./paper-elapsed-soak.js");

const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp) throw new Error("RUNNER_TEMP is required for CI elapsed soak");
const runId = process.env.GITHUB_RUN_ID || "local";
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || "1";
const databasePath = join(runnerTemp, `nusa-paper-soak-${runId}-${runAttempt}`, "state.sqlite");

run({ databasePath }).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
