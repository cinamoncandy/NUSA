const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Product principle (P1): RESULT and LEARNING must be clearly separated and each legible on its
// own. The PAPER observatory already put them in separate cards ("누적 PAPER 성과" for RESULT,
// a learning/evaluation card for LEARNING) but the LEARNING card only ever showed a raw enum
// (PROMOTE/REJECT/PAUSE/UNCHANGED) and hashes -- no plain-language sentence a supervisor could
// read without knowing the underlying data model. These tests hold the new summary sentence to
// the same truthfulness bar as the rest of the screen.

test("the learning/evaluation card is titled and readable in the same language as the rest of the screen", () => {
  const view = read("apps/mobile/src/paperLearningMonitorView.tsx");
  assert.match(view, /학습 \/ 평가/);
  assert.doesNotMatch(view, /Learning \/ Evaluation/);
  assert.match(view, /testID="paper-learning-evaluation-card"/);
});

test("the learning outcome is summarized in plain language, distinct from RESULT's PnL summary", () => {
  const view = read("apps/mobile/src/paperLearningMonitorView.tsx");
  assert.match(view, /function learningOutcomeSummary/);
  assert.match(view, /learningOutcomeLabel: Record<string, string> = \{ PROMOTE: "전략 승격", REJECT: "전략 거부", PAUSE: "일시 중단", UNCHANGED: "변경 없음" \}/);
  assert.match(view, /testID="paper-learning-outcome-summary"/);
  // RESULT (누적 PAPER 성과) and LEARNING (학습 \/ 평가) must remain two separate cards.
  const resultIndex = view.indexOf("누적 PAPER 성과");
  const learningIndex = view.indexOf("학습 / 평가");
  assert.ok(resultIndex > 0 && learningIndex > 0 && resultIndex !== learningIndex);
});

test("no learning evidence is reported truthfully, never as a fabricated outcome", () => {
  const view = read("apps/mobile/src/paperLearningMonitorView.tsx");
  assert.match(view, /if \(evidence\?\.outcome == null\) return "아직 검증된 학습 평가 결론이 없습니다\."/);
});
