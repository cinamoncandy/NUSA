const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperFunnelCounters, funnelReasonCodes, funnelConversions, FUNNEL_MAX_KEYS, FUNNEL_OTHER_KEY } = require("../dist/apps/cloud/src/paperFunnelCounters.js");
const { PaperLearningEventRecorder, paperLearningCycleId } = require("../dist/apps/cloud/src/paperLearningObservability.js");

test("a reason keeps only its fixed upper-case codes, never values, identifiers or free text", () => {
  assert.deepEqual(funnelReasonCodes("CONSECUTIVE_LOSS_LIMIT"), ["CONSECUTIVE_LOSS_LIMIT"]);
  assert.deepEqual(funnelReasonCodes("DAILY_LOSS_LIMIT,CONSECUTIVE_LOSS_LIMIT"), ["DAILY_LOSS_LIMIT", "CONSECUTIVE_LOSS_LIMIT"]);
  assert.deepEqual(funnelReasonCodes("UNSUPPORTED_ACTION:BUY"), ["UNSUPPORTED_ACTION", "BUY"]);
  assert.deepEqual(funnelReasonCodes("source=UPBIT_PUBLIC_TICKER;observedAt=1791259039230"), [], "key=value pairs and numbers are dropped");
  assert.deepEqual(funnelReasonCodes("balance is 9,999 KRW for acct-123"), [], "free text is dropped");
  assert.deepEqual(funnelReasonCodes("lowercase_code"), []);
  assert.deepEqual(funnelReasonCodes("A".repeat(60)), [], "an over-long code is dropped");
  assert.deepEqual(funnelReasonCodes(undefined), []);
  assert.deepEqual(funnelReasonCodes("A_B,A_B,C_D"), ["A_B", "C_D"], "repeats count once per event");
  assert.equal(funnelReasonCodes("AA,BB,CC,DD,EE,FF").length, 4, "at most four codes per event");
});

test("each event adds a stage total and one count per code; a decision also counts its action", () => {
  const f = new PaperFunnelCounters(() => 1_000);
  f.observe({ stage: "MARKET_DATA", status: "PASS", reason: "source=UPBIT_PUBLIC_TICKER;observedAt=5" });
  f.observe({ stage: "DECISION", status: "PASS", decision: { action: "BUY" } });
  f.observe({ stage: "DECISION", status: "SKIP", reason: "NO_ACTIONABLE_PAPER_DECISION:HOLD", decision: { action: "HOLD" } });
  f.observe({ stage: "RISK", status: "FAIL", reason: "CONSECUTIVE_LOSS_LIMIT" });
  f.observe({ stage: "bad stage!", status: "PASS" });
  f.observe({ stage: "RISK", status: "MAYBE" });
  const snap = f.snapshot();
  assert.equal(snap.since, 1_000);
  assert.deepEqual(snap.counts, { "DECISION:PASS": 1, "DECISION:PASS:BUY": 1, "DECISION:SKIP": 1, "DECISION:SKIP:HOLD": 1, "DECISION:SKIP:NO_ACTIONABLE_PAPER_DECISION": 1, "MARKET_DATA:PASS": 1, "RISK:FAIL": 1, "RISK:FAIL:CONSECUTIVE_LOSS_LIMIT": 1 });
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.counts));
});

test("distinct detail keys are bounded and the overflow is counted under OTHER, never dropped", () => {
  const f = new PaperFunnelCounters(() => 0);
  for (let i = 0; i < FUNNEL_MAX_KEYS + 25; i += 1) f.observe({ stage: "RISK", status: "FAIL", reason: `CODE_${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}` });
  const { counts } = f.snapshot();
  const detail = Object.keys(counts).filter((k) => k.split(":").length > 2 || k === FUNNEL_OTHER_KEY);
  assert.ok(detail.length <= FUNNEL_MAX_KEYS + 1, `${detail.length} detail keys`);
  assert.equal(counts["RISK:FAIL"], FUNNEL_MAX_KEYS + 25, "the stage total is exact");
  assert.equal(counts[FUNNEL_OTHER_KEY], 25 + 0, "the overflow lands in OTHER");
  // The stage totals of every real stage and status still fit: they are not part of the bound.
  for (const stage of ["MARKET_DATA", "SIGNAL", "CANDIDATE", "DECISION", "PERMISSION", "RISK", "ORDER_INTENT", "FILL", "PNL"]) for (const status of ["PASS", "SKIP", "FAIL"]) f.observe({ stage, status });
  assert.equal(f.snapshot().counts["PNL:FAIL"], 1);
});

test("the conversion rates read the funnel from market to ledger and are null when the earlier stage is empty", () => {
  const counts = { "MARKET_DATA:PASS": 1000, "DECISION:PASS": 40, "DECISION:SKIP": 960, "DECISION:PASS:BUY": 30, "DECISION:PASS:SELL": 10, "RISK:PASS": 4, "RISK:FAIL": 36, "ORDER_INTENT:PASS": 4, "FILL:PASS": 3, "PNL:PASS": 3 };
  const r = funnelConversions(counts);
  assert.equal(r.marketToDecision, 1);
  assert.equal(r.decisionToActionable, 40 / 1000);
  assert.equal(r.actionableToRiskPass, 4 / 40);
  assert.equal(r.riskPassToIntent, 1);
  assert.equal(r.intentToFill, 3 / 4);
  assert.equal(r.fillToPnl, 1);
  assert.equal(funnelConversions({}).intentToFill, null);
});

test("the recorder counts an event once, however often it is recorded, and exposes the snapshot without replaying anything", () => {
  const recorder = new PaperLearningEventRecorder({ persistencePath: ":memory:" });
  const cycleId = paperLearningCycleId("KRW-XRP", 1_791_259_039_230);
  const decision = { cycleId, stage: "DECISION", occurredAt: 1_791_259_039_230, market: "KRW-XRP", status: "PASS", decision: { action: "BUY", allocation: 0.1, confidence: 0.8 } };
  recorder.record(decision);
  recorder.record(decision);
  recorder.record({ cycleId, stage: "RISK", occurredAt: 1_791_259_039_231, market: "KRW-XRP", status: "FAIL", reason: "CONSECUTIVE_LOSS_LIMIT" });
  const counts = recorder.funnelSnapshot().counts;
  assert.equal(counts["DECISION:PASS"], 1);
  assert.equal(counts["DECISION:PASS:BUY"], 1);
  assert.equal(counts["RISK:FAIL:CONSECUTIVE_LOSS_LIMIT"], 1);
  assert.equal(recorder.replay().length, 2, "the recorded events are unchanged by counting");
  recorder.close();
});

test("the counters are display-only: the recorder module calls them only to observe and snapshot", () => {
  const src = require("node:fs").readFileSync("apps/cloud/src/paperFunnelCounters.ts", "utf8");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /^import /m, "no dependency on execution, risk or ledger code");
  const rec = require("node:fs").readFileSync("apps/cloud/src/paperLearningObservability.ts", "utf8");
  assert.equal((rec.match(/this\.funnel\./g) ?? []).length, 2, "only observe and snapshot touch it");
});
