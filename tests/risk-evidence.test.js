const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GlobalRiskGateway } = require("../dist/apps/execution/src/global-risk-gateway.js");
const { SqliteRiskEvidenceRepository } = require("../dist/packages/storage/src/risk-evidence.js");

const policy = { policyVersion: "risk-v1", maxGlobalExposure: "100", maxDailyLoss: "100", maxPositionSize: "100", maxPositionCount: 10, maxStrategyExposure: "100", maxSymbolExposure: "100", maxConsecutiveLosses: 5 };
const context = (overrides = {}) => ({ exchange: "UPBIT", strategyId: "sma", symbol: "KRW-BTC", sessionId: "s1", currentPosition: "0", openOrderExposure: "0", partialFillExposure: "0", expectedFillExposure: "1", realizedPnl: "0", unrealizedPnl: "0", positionCount: 0, strategyExposure: "0", symbolExposure: "0", consecutiveLosses: 0, unknownExecutionCount: 0, reconciliationStatus: "MATCH", marketData: "HEALTHY", credentialStatus: "READY", recoveryStatus: "COMPLETE", manualApprovalToken: "approval", productionMutationAllowed: false, killSwitches: [], ...overrides });

test("every risk result is append-only, queryable, and survives database recovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-risk-evidence-"));
  const databasePath = path.join(directory, "risk.sqlite");
  const db = new DatabaseSync(databasePath);
  const repository = new SqliteRiskEvidenceRepository({ connection: db });
  const gateway = new GlobalRiskGateway(policy, repository);
  const approved = gateway.evaluate("exec-1", context(), "2026-08-01T00:00:00.000Z");
  const blocked = gateway.evaluate("exec-2", context({ marketData: "DISCONNECTED" }));
  gateway.evaluate("exec-3", context({ expectedFillExposure: "101" })); // rejected; absence asserted via repository below
  const unknown = gateway.evaluate("exec-4", context({ expectedFillExposure: "invalid" }));
  assert.equal(repository.getByDecisionId(approved.decisionId).result, "APPROVED");
  assert.equal(approved.observedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(approved.ruleId, "risk-v1");
  assert.equal(approved.correlationId, "exec-1:2026-08-01T00:00:00.000Z");
  assert.equal(approved.inputParameters.expectedFillExposure, "1");
  assert.equal(approved.accountState.positionCount, 0);
  assert.equal(approved.marketState.marketData, "HEALTHY");
  assert.equal(Object.prototype.hasOwnProperty.call(approved.inputParameters, "manualApprovalToken"), false);
  assert.equal(repository.list({ result: "BLOCKED" }).length, 1);
  assert.throws(() => repository.append(approved), /UNIQUE|constraint/i);
  const rows = repository.list({ executionId: "exec-1" });
  assert.deepEqual(rows[0], approved);
  assert.equal(repository.getByDecisionId(blocked.decisionId).reasonCodes[0], "MARKET_DATA_DISCONNECTED");
  db.close();
  const recoveredDb = new DatabaseSync(databasePath);
  const recovered = new SqliteRiskEvidenceRepository({ connection: recoveredDb });
  assert.deepEqual(recovered.list().map((record) => record.result), ["APPROVED", "BLOCKED", "REJECTED", "UNKNOWN"]);
  assert.equal(recovered.getByDecisionId(unknown.decisionId).result, "UNKNOWN");
  recoveredDb.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
