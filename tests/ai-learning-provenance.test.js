const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { normalizeAiLearningProvenance } = require("../dist/packages/contracts/src/aiInference.js");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const baseResult = () => ({
  status: "COMPLETED",
  orchestrationRunId: "learning-provenance-test",
  governanceDecision: { result: "preview_candidate", unresolvedDisagreements: [], vetoReasons: [] },
  independence: { reasonCodes: [] },
  agents: [],
  contexts: [],
  runs: [],
  failureCodes: [],
  outputHashes: [],
  structuredOutputs: [],
  liveAuthority: "NONE",
  realOrderAuthority: false,
  realTransferAuthority: false,
  productionMutationAllowed: false,
});

test("projection preserves repository-bound automatic provenance and fails closed for untrusted evidence", () => {
  assert.equal(normalizeAiLearningProvenance("AUTO_BACKGROUND"), "AUTO_BACKGROUND");
  assert.equal(normalizeAiLearningProvenance("USER_TRIGGERED"), "UNKNOWN");
  for (const value of [undefined, null, "", "APP_BACKGROUND", "user", "USER_TRIGGERED", 1]) {
    assert.equal(normalizeAiLearningProvenance(value), "UNKNOWN");
    assert.equal(projectAiReadOnly({ ...baseResult(), learningProvenance: value }).learningProvenance, "UNKNOWN");
  }
  assert.equal(projectAiReadOnly({ ...baseResult(), learningProvenance: "AUTO_BACKGROUND" }).learningProvenance, "AUTO_BACKGROUND");
  assert.equal(projectAiReadOnly(null).learningProvenance, "UNKNOWN");
});

test("cloud runtime binds the automatic market-tick path and mobile renders provenance read-only", () => {
  const runtime = read("apps/cloud/src/runtime.ts");
  const orchestrator = read("apps/cloud/src/ai/multiAgentOrchestrator.ts");
  const contracts = read("packages/contracts/src/aiInference.ts");
  const mobile = read("apps/mobile/src/aiView.tsx");
  assert.match(runtime, /contextValidForMs: 120_000, learningProvenance: "AUTO_BACKGROUND"/);
  assert.match(orchestrator, /learningProvenance: normalizeAiLearningProvenance\(input\.learningProvenance\)/);
  assert.match(contracts, /USER_TRIGGERED remains UNKNOWN until a canonical trusted trigger receipt exists/);
  assert.match(mobile, /AUTO_BACKGROUND: "백그라운드 자동 실행"/);
  assert.match(mobile, /USER_TRIGGERED: "사용자 요청"/);
  assert.match(mobile, /UNKNOWN: "알 수 없음"/);
  assert.match(mobile, /testID="ai-learning-provenance" accessible accessibilityRole="text"/);
  assert.match(mobile, /실행 근거가 확인되지 않아 출처를 분류하지 않습니다/);
  assert.doesNotMatch(mobile, /productionMutationAllowed\s*[:=]\s*true/);
});
