const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { SqliteRiskEvidenceRepository } = require("../dist/packages/storage/src/risk-evidence.js");
const { toPaperRiskEvidence } = require("../dist/apps/desktop/src/paper/paperOperationalPreflight.js");

test("Paper risk evidence survives reopening the same SQLite database and remains queryable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-risk-evidence-"));
  const filename = path.join(root, "nusa.sqlite");
  const request = {
    schemaVersion: 1, requestId: "request-1", signalId: "signal-1", commandId: "command-1", clientOrderId: "client-1",
    strategyFingerprint: "s", configFingerprint: "c", runtimeFingerprint: "r", riskPolicyFingerprint: "policy-v1",
    symbol: "KRW-BTC", side: "BUY", quantity: 1, referencePrice: 100, requestedAt: 1_000,
    marketDataState: { status: "HEALTHY", price: 100 }, accountState: { cash: 1_000, positionQuantity: 0, openOrderCount: 0 },
    controlState: { killSwitchActive: false, liveCapabilityDetected: false, privateApiCapabilityDetected: false },
    approvalState: { approved: true, expiresAt: 2_000, symbols: ["KRW-BTC"] }, persistenceState: { healthy: true },
    reconciliationState: { healthy: true, openP0: false }, deploymentState: { integrityVerified: true },
    rateState: { ordersInLastSecond: 0, ordersInLastMinute: 0, sameSideStreak: 0 },
    exposureState: { symbolExposureNotional: 0, portfolioExposureNotional: 0, dailyBuyNotional: 0, dailySellNotional: 0 },
    sessionState: { dailyRealizedPnL: 0, consecutiveLossCount: 0, sessionPeakEquity: 1_000, sessionEquity: 1_000 }
  };
  const decision = { status: "ALLOW", reasonCodes: [], evaluatedAt: 1_000, requestSha256: "request-hash", decisionSha256: "decision-hash", productionMutationAllowed: false };
  const firstDb = new DatabaseSync(filename);
  const first = new SqliteRiskEvidenceRepository({ connection: firstDb });
  first.append(toPaperRiskEvidence(request, decision));
  firstDb.close();
  const secondDb = new DatabaseSync(filename);
  const second = new SqliteRiskEvidenceRepository({ connection: secondDb });
  const records = second.list({ executionId: "command-1" });
  assert.equal(records.length, 1);
  assert.equal(records[0].result, "APPROVED");
  assert.equal(records[0].inputParameters.clientOrderId, "client-1");
  assert.equal(records[0].marketState.recovery, "MATCHED");
  secondDb.close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
});
