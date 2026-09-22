const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Product principle: PAPER is NUSA's own behavior observatory first, a manual order ticket
// second -- not the reverse. Before this change, the only visible content on entering PAPER was
// a manual order ticket; what NUSA itself observed/decided was reachable only via a plain,
// unlabeled "PAPER 학습 보기" button with zero information density. These tests hold the new
// PaperActivitySummary to the product's truthfulness and observatory-first requirements.

// PaperActivitySummary lived in tradingViewLegacy.tsx, the manual order ticket. The board has no
// ORDER destination, so the summary has no ticket to render above and the three ordering,
// truthfulness and status-confidence blocks that asserted on it have no subject left. The
// observatory-first principle is now carried by PAPER itself being the learning monitor, which
// tests/mobile-paper-learning-monitor-only.test.js holds, and by the single-source contract below.

test("App wires the same paperLearningState already computed for the observatory into PAPER's summary, not a second source", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /const paperLearningState = buildPaperLearningScreen\(/);
  // The single-source contract is what matters, not which screen consumes it. The order ticket
  // that used to take paperLearning is gone with the board's five-tab structure; the PAPER
  // monitor and the shadow monitor now both read the one state computed here.
  assert.match(app, /<PaperLearningMonitorView state=\{paperLearningState\}/);
  assert.equal(app.match(/buildPaperLearningScreen\(/g).length, 1, "paperLearningState must have exactly one source");
  assert.match(app, /<PaperShadowMonitorView paper=\{paperLearningState\}/);
});

test("no LIVE or production-mutation authority is introduced by the PAPER observatory", () => {
  const monitor = read("apps/mobile/src/paperLearningMonitorView.tsx");
  for (const forbidden of ["productionMutationAllowed: true", "authority: \"LIVE\"", "placeOrder(", "onWithdraw", "onTransfer"]) {
    assert.equal(monitor.includes(forbidden), false, `${forbidden} must not appear`);
  }
});
