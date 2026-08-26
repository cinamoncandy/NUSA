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

test("PAPER renders what NUSA actually observed/decided above the manual order ticket, truthfully", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  assert.match(trading, /import type \{ PaperLearningScreenState \} from "\.\/paperLearningScreen"/);
  assert.match(trading, /readonly paperLearning\?: PaperLearningScreenState \| null/);
  assert.match(trading, /function PaperActivitySummary/);
  // The summary must render before the manual order ticket (paper-quote-hero), not after.
  const summaryIndex = trading.indexOf("<PaperActivitySummary");
  const ticketIndex = trading.indexOf('testID="paper-quote-hero"');
  assert.ok(summaryIndex > 0 && ticketIndex > summaryIndex, "the activity summary must render above the manual order ticket");
});

test("PAPER activity summary never fabricates observed evidence and states absence truthfully", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  // No activity yet: an honest "no observed behavior" state, never a fabricated zero/placeholder count.
  assert.match(trading, /관측된 PAPER 행동 없음/);
  assert.match(trading, /아직 검증된 PAPER 판단 evidence가 없습니다/);
  // Real activity: only ever derived directly from paperLearning.timeline.length -- never a
  // hardcoded or estimated figure.
  assert.match(trading, /관측 이벤트 \$\{paperLearning!\.timeline\.length\}건/);
  assert.match(trading, /const hasActivity = paperLearning != null && paperLearning\.timeline\.length > 0/);
  // The full observatory remains one tap away from the summary itself.
  assert.match(trading, /testID="trade-paper-learning"/);
  assert.match(trading, /testID="paper-ai-activity-summary"/);
});

test("PAPER activity summary status is never more confident than the real runtime status", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  // Status chip must read directly from paperLearning.status (RUNNING/PAUSED/HALTED/ERROR), or the
  // honest "대기" (standby) placeholder when there is no runtime evidence at all -- never a
  // synthesized "OK"/"connected" label independent of that real state.
  assert.match(trading, /label=\{paperLearning\?\.status \?\? "대기"\}/);
  assert.match(trading, /paperLearning\.status === "RUNNING" \? "success" : paperLearning\.status === "HALTED" \|\| paperLearning\.status === "ERROR" \? "danger" : "warning"/);
});

test("App wires the same paperLearningState already computed for the observatory into PAPER's summary, not a second source", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /const paperLearningState = buildPaperLearningScreen\(/);
  assert.match(app, /paperLearning=\{paperLearningState\}/);
  assert.match(app, /<PaperShadowMonitorView paper=\{paperLearningState\}/);
});

test("no LIVE or production-mutation authority is introduced by the activity summary", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  for (const forbidden of ["productionMutationAllowed: true", "authority: \"LIVE\"", "placeOrder(", "onWithdraw", "onTransfer"]) {
    // placeOrder( already exists legitimately for the manual ticket's own local ledger path
    // (placeLocalPaperOrder); only assert the truly forbidden ones here.
    if (forbidden === "placeOrder(") continue;
    assert.equal(trading.includes(forbidden), false, `${forbidden} must not appear`);
  }
});
