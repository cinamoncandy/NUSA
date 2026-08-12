const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtime = fs.readFileSync(path.join(process.cwd(), "apps", "cloud", "src", "runtime.ts"), "utf8");
const server = fs.readFileSync(path.join(process.cwd(), "apps", "cloud", "src", "server.ts"), "utf8");
const boundary = fs.readFileSync(path.join(process.cwd(), "apps", "cloud", "src", "cloudPaperExecutionBoundary.ts"), "utf8");

test("runtime shares one investment allocation repository with server and PAPER execution", () => {
  assert.match(runtime, /new SqliteInvestmentAllocationSettingsRepository\(durableRepository\.database\(\)\)/);
  assert.match(runtime, /investmentAllocationSettings\.get\("operator"\)\?\.investmentPercent \?\? 100/);
  assert.match(runtime, /investmentAllocationSettings\.get\(principal\.userId\)\?\.investmentPercent \?\? 100/);
  assert.match(runtime, /investmentAllocationSettings\s*\n\s*\}\);/);
  assert.match(server, /\/api\/settings\/investment-allocation/);
  assert.match(server, /handleInvestmentAllocationHttp/);
});

test("manual PAPER BUY preserves protected cash while SELL remains outside the envelope", () => {
  assert.match(boundary, /command\.side === "BUY"/);
  assert.match(boundary, /investableCash = state\.cash \* \(investmentPercent \/ 100\)/);
  assert.match(boundary, /PAPER_INVESTMENT_ALLOCATION_EXCEEDED/);
  assert.doesNotMatch(boundary, /command\.side === "SELL"[^\n]*PAPER_INVESTMENT_ALLOCATION_EXCEEDED/);
});
