import assert from "node:assert/strict";
import test from "node:test";
import { buildLearningFunnel } from "./learningFunnelModel";

test("418 -> 15 -> 0 narrows, a zero stage stays visible and is marked for attention", () => {
  const m = buildLearningFunnel({ configurations: 418, discoveryPasses: 15, holdoutPasses: 0, cyclesEvaluated: 0, evaluatedAt: 1 });
  assert.ok(m);
  assert.match(m.headline, /418개/);
  assert.deepEqual(m.stages.map((s) => s.value), [418, 15, 0]);
  assert.equal(m.stages[0].width, 1);
  assert.ok(m.stages[1].width < 1 && m.stages[1].width >= 0.18);
  assert.equal(m.stages[2].width, 0.18);
  assert.equal(m.stages[2].tone, "ATTENTION");
});

test("missing, malformed or inconsistent input shows nothing", () => {
  for (const bad of [null, [], {}, { configurations: 0, discoveryPasses: 0, holdoutPasses: 0, cyclesEvaluated: 0 }, { configurations: 10, discoveryPasses: 11, holdoutPasses: 0, cyclesEvaluated: 0 }, { configurations: 10, discoveryPasses: 2, holdoutPasses: -1, cyclesEvaluated: 0 }, { configurations: 418, discoveryPasses: 3, holdoutPasses: 5, cyclesEvaluated: 0 }, { configurations: "418", discoveryPasses: 15, holdoutPasses: 0, cyclesEvaluated: 0 }]) {
    assert.equal(buildLearningFunnel(bad), null, JSON.stringify(bad));
  }
});

test("a passing candidate changes the copy, and the cycle count is labelled as this run's", () => {
  const m = buildLearningFunnel({ configurations: 418, discoveryPasses: 15, holdoutPasses: 1, cyclesEvaluated: 2, evaluatedAt: 1 });
  assert.ok(m);
  assert.match(m.headline, /1개가 독립 검증을 통과/);
  assert.equal(m.sub, "이번 실행에서 평가한 학습 사이클 2번");
  assert.equal(m.stages[2].tone, "NORMAL");
});
