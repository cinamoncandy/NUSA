"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { PaperTradePermissionStoreWriter } = require("../dist/apps/cloud/src/paperTradePermissionStore.js");
const { NO_PAPER_TRADE_PERMISSION_AUTHORITY, refusePaperTradePermission } = require("../dist/apps/cloud/src/paperTradePermissionGuard.js");
const { resolvePaperTradePermissionAuthority, parsePermitPolicyFile, PERMIT_POLICY_FILE_ENV } = require("../dist/apps/cloud/src/paperTradePermissionAuthorityFromEnv.js");

const policy = () => ({
  policyVersion: "test-policy-1", minimumDataQuality: 0.9, maximumAgeMs: 60000, compatibleRegimes: ["TREND"], minimumCalibratedProbability: 0.6,
  minimumNetExpectedValue: 0.001, minimumRewardToRisk: 1.5, minimumLiquidityScore: 0.5, minimumCapacityUsd: 100, maximumSlippageBps: 10,
  maximumUncertainty: 0.2, maximumModelDispersion: 0.1, maximumRiskBudgetUsage: 0.5, permissionTtlMs: 30000
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "permit-authority-"));
let policySeq = 0;
const writePolicy = (dir, body) => { const file = path.join(dir, `policy-${policySeq += 1}.json`); fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body)); return file; };
const query = { decisionId: "d1", strategyId: "s1", market: "KRW-XRP" };

test("without a policy file the result is exactly the no-permit authority (default OFF)", () => {
  const result = resolvePaperTradePermissionAuthority({}, "/nonexistent.sqlite");
  assert.equal(result.status, "OFF");
  assert.equal(result.authority, NO_PAPER_TRADE_PERMISSION_AUTHORITY);
  const blank = resolvePaperTradePermissionAuthority({ [PERMIT_POLICY_FILE_ENV]: "  " }, "/nonexistent.sqlite");
  assert.equal(blank.authority, NO_PAPER_TRADE_PERMISSION_AUTHORITY);
});

test("every problem falls back to the no-permit authority and never relaxes anything", () => {
  const dir = tmp();
  const db = path.join(dir, "state.sqlite");
  const good = writePolicy(dir, { policy: policy(), probabilityModelVersion: "m1" });
  const cases = [
    [{ [PERMIT_POLICY_FILE_ENV]: good }, undefined, "STATE_DB_PATH_MISSING"],
    [{ [PERMIT_POLICY_FILE_ENV]: path.join(dir, "missing.json") }, db, "POLICY_FILE_INVALID"],
    [{ [PERMIT_POLICY_FILE_ENV]: writePolicy(dir, "{not json") }, db, "POLICY_FILE_INVALID"],
    [{ [PERMIT_POLICY_FILE_ENV]: writePolicy(dir, { policy: { ...policy(), maximumAgeMs: "60000" }, probabilityModelVersion: "m1" }) }, db, "POLICY_FILE_INVALID"],
    [{ [PERMIT_POLICY_FILE_ENV]: writePolicy(dir, { policy: { ...policy(), compatibleRegimes: [] }, probabilityModelVersion: "m1" }) }, db, "POLICY_FILE_INVALID"],
    [{ [PERMIT_POLICY_FILE_ENV]: writePolicy(dir, { policy: policy(), probabilityModelVersion: "" }) }, db, "POLICY_FILE_INVALID"],
    [{ [PERMIT_POLICY_FILE_ENV]: good }, db, "STORE_OPEN_FAILED"]
  ];
  for (const [env, dbPath, reason] of cases) {
    const result = resolvePaperTradePermissionAuthority(env, dbPath);
    assert.equal(result.status, "FALLBACK_NO_PERMIT", reason);
    assert.equal(result.reason, reason);
    assert.equal(result.authority, NO_PAPER_TRADE_PERMISSION_AUTHORITY);
  }
});

test("a valid policy file and an existing store give a read-only authority that still refuses without a permit", () => {
  const dir = tmp();
  const dbPath = path.join(dir, "state.sqlite");
  const writerDb = new SqliteDatabase(dbPath);
  new PaperTradePermissionStoreWriter(writerDb);
  const file = writePolicy(dir, { policy: policy(), probabilityModelVersion: "m1" });
  const result = resolvePaperTradePermissionAuthority({ [PERMIT_POLICY_FILE_ENV]: file }, dbPath);
  try {
    assert.equal(result.status, "STORE_READ_ONLY");
    assert.notEqual(result.authority, NO_PAPER_TRADE_PERMISSION_AUTHORITY);
    assert.equal(result.authority.policy.policyVersion, "test-policy-1");
    assert.equal(result.authority.latestPermit(query), null);
    const refusal = refusePaperTradePermission(result.authority, query, Date.now(), new Map());
    assert.ok(refusal != null, "no permit in the store means the order is refused");
  } finally {
    result.close();
    writerDb.close?.();
  }
});

test("policy parsing is strict", () => {
  assert.throws(() => parsePermitPolicyFile("[]"));
  assert.throws(() => parsePermitPolicyFile(JSON.stringify({ probabilityModelVersion: "m" })));
  const parsed = parsePermitPolicyFile(JSON.stringify({ policy: policy(), probabilityModelVersion: "m1" }));
  assert.equal(parsed.policy.policyVersion, "test-policy-1");
  assert.ok(Object.isFrozen(parsed.policy));
});

test("source pins: the composition never imports the store writer, and the production runtime uses it", () => {
  const composition = fs.readFileSync(path.join(__dirname, "../apps/cloud/src/paperTradePermissionAuthorityFromEnv.ts"), "utf8");
  assert.ok(!/PaperTradePermissionStoreWriter/.test(composition));
  assert.ok(!/paperTradePermissionProducer|\bexec\(|\bINSERT\b/i.test(composition));
  const runtime = fs.readFileSync(path.join(__dirname, "../apps/cloud/src/closedLearningProductionRuntime.ts"), "utf8");
  assert.match(runtime, /resolvePaperTradePermissionAuthority\(env, config\.cloudStateDbPath\)/);
  assert.match(runtime, /tradePermissionAuthority: permitAuthority\.authority/);
});
