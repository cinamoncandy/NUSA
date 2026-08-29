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

test("projection preserves only explicit learning provenance and fails closed for missing or malformed evidence", () => {
  assert.equal(normalizeAiLearningProvenance("AUTO_BACKGROUND"), "AUTO_BACKGROUND");
  assert.equal(normalizeAiLearningProvenance("USER_TRIGGERED"), "USER_TRIGGERED");
  for (const value of [undefined, null, "", "APP_BACKGROUND", "user", 1]) {
    assert.equal(normalizeAiLearningProvenance(value), "UNKNOWN");
    assert.equal(projectAiReadOnly({ ...baseResult(), learningProvenance: value }).learningProvenance, "UNKNOWN");
  }
  for (const value of ["AUTO_BACKGROUND", "USER_TRIGGERED"]) {
    assert.equal(projectAiReadOnly({ ...baseResult(), learningProvenance: value }).learningProvenance, value);
  }
  assert.equal(projectAiReadOnly(null).learningProvenance, "UNKNOWN");
});

test("cloud runtime binds the automatic market-tick path while the mobile LEARNING surface stays read-only and accessible", () => {
  const runtime = read("apps/cloud/src/runtime.ts");
  const orchestrator = read("apps/cloud/src/ai/multiAgentOrchestrator.ts");
  const mobile = read("apps/mobile/src/aiView.tsx");
  assert.match(runtime, /contextValidForMs: 120_000, learningProvenance: "AUTO_BACKGROUND"/);
  assert.match(orchestrator, /learningProvenance: normalizeAiLearningProvenance\(input\.learningProvenance\)/);
  assert.match(orchestrator, /learningProvenance: normalizeAiLearningProvenance\(input\.learningProvenance\),\s*providerId/);
  assert.match(mobile, /AUTO_BACKGROUND: "백그라운드 자동 실행"/);
  assert.match(mobile, /USER_TRIGGERED: "사용자 요청"/);
  assert.match(mobile, /UNKNOWN: "알 수 없음"/);
  assert.match(mobile, /testID="ai-learning-provenance" accessible accessibilityRole="text"/);
  assert.match(mobile, /실행 근거가 확인되지 않아 출처를 분류하지 않습니다/);
  assert.doesNotMatch(mobile, /현재 읽기 전용 projection은 AUTO_BACKGROUND와 USER_TRIGGERED의 학습 근거를 구분해 제공하지 않습니다/);
  assert.doesNotMatch(mobile, /productionMutationAllowed\s*[:=]\s*true/);
});

