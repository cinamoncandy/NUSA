"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const SRC = path.join(__dirname, "..", "apps", "mobile", "src");
function load(name) {
  const out = ts.transpileModule(fs.readFileSync(path.join(SRC, `${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", out)(mod, mod.exports, (id) => load(id.replace(/^\.\//, "")));
  return mod.exports;
}
const { buildLearningScreen } = load("learningScreenModel");
const perf = { realizedPnL: -23, unrealizedPnL: 0, fees: 2.5, turnover: 0, completedCycles: 10, filledCycles: 2, winRate: null, expectancy: null, maxDrawdown: 0.022 };
const base = { readOnly: true, mode: "PAPER", currentCycle: "c", status: "RUNNING", dataSource: "CLOUD", latestMarket: "KRW-XRP", latestStrategy: {}, latestSignal: { action: "BUY" }, latestDecision: { action: "BUY", allocation: 0.1, confidence: 0.6 }, latestGates: [], latestRisk: { status: "FAIL", reason: "CONSECUTIVE_LOSS_LIMIT" }, latestFill: null, latestAccount: null, latestEvidence: null, timeline: [], recentCycles: [], performance: perf, entryPoints: [], autoRefresh: true, halt: null };

test("risk block is shown as the narrowest step, in amber, with the server's code", () => {
  const m = buildLearningScreen(base);
  assert.equal(m.tone, "ATTENTION");
  assert.equal(m.steps.find((s) => s.label === "안전").state, "BLOCKED");
  assert.equal(m.steps.find((s) => s.label === "체결").state, "NONE");
  assert.match(m.narrowest, /CONSECUTIVE_LOSS_LIMIT/);
  assert.equal(m.rows.find((r) => r.label === "실현 손익").value, "−₩23");
  assert.equal(m.rows.find((r) => r.label === "승률").value, "—");
});

test("missing server data never shows results or healthy", () => {
  for (const dataSource of ["NOT_CONFIGURED", "UNAVAILABLE", "PROJECTION_ABSENT"]) {
    const m = buildLearningScreen({ ...base, dataSource });
    assert.equal(m.tone, "ATTENTION");
    assert.equal(m.rows.length, 0);
    assert.equal(m.headline, "학습 정보를 받지 못했어요");
  }
});

test("halted is red", () => {
  assert.equal(buildLearningScreen({ ...base, status: "HALTED", latestRisk: null }).tone, "LOSS");
});

test("a long Korean hero sentence splits at a space near the middle and short text stays whole", () => {
  const { splitHeroLines } = require("../dist/apps/mobile/src/learningScreenModel.js");
  assert.deepEqual(splitHeroLines("모의투자로 배우는 중이에요"), ["모의투자로", "배우는 중이에요"]);
  assert.deepEqual(splitHeroLines("학습 정보를 받지 못했어요"), ["학습 정보를", "받지 못했어요"]);
  assert.deepEqual(splitHeroLines("학습이 멈춰 있어요"), ["학습이", "멈춰 있어요"], "a tie goes to the earlier space");
  assert.deepEqual(splitHeroLines("멈춤"), ["멈춤"]);
  assert.deepEqual(splitHeroLines("가나다라마바사아자차카타"), ["가나다라마바사아자차카타"], "no space, nothing to split");
  assert.deepEqual(splitHeroLines(""), [""]);
  // the words are unchanged: joining the lines gives the same text back
  for (const t of ["모의투자로 배우는 중이에요", "학습이 잠시 쉬고 있어요", "학습에 오류가 있어요"]) assert.equal(splitHeroLines(t).join(" "), t);
});

test("hero lines share one font size that fits the widest line and never exceed the designed 54 px", () => {
  const { heroFontSize, splitHeroLines, HERO_FONT_SIZE } = require("../dist/apps/mobile/src/learningScreenModel.js");
  assert.equal(HERO_FONT_SIZE, 54);
  // short lines keep the designed size on a 390 px phone (350 px inside the 20 px margins)
  assert.equal(heroFontSize(["모두", "정상이에요"], 350), 54);
  assert.equal(heroFontSize(["오늘의", "로그"], 350), 54);
  // "배우는 중이에요" is 7 glyphs and a space: at 54 px it is wider than 350 px, so every line shrinks together
  const fitted = heroFontSize(splitHeroLines("모의투자로 배우는 중이에요"), 350);
  assert.ok(fitted < 54 && fitted >= 44, `fitted ${fitted}`);
  const widthAt = (text, size) => Array.from(text).reduce((sum, ch) => sum + (/\s/.test(ch) ? 0.3 : ch.charCodeAt(0) < 0x80 ? 0.62 : 1) * size - 2 * size / 54, 0);
  assert.ok(widthAt("배우는 중이에요", fitted) <= 350);
  // narrower phones shrink further but stop at 36 px; a missing or zero width keeps the designed size
  assert.ok(heroFontSize(["배우는 중이에요"], 320) < fitted);
  assert.equal(heroFontSize(["가나다라마바사아자차카타파하"], 200), 36);
  assert.equal(heroFontSize(["멈춤"], 0), 54);
  assert.equal(heroFontSize([""], 350), 54);
  // Latin text is narrower than Korean at the same size
  assert.equal(heroFontSize(["NUSA를", "깨우는 중"], 350), 54);
});

// UI/UX v6 phase 1 (docs/NUSA_MOBILE_UIUX_V6_CALM_FIELD.md): a paused loop in COLLECT_ONLY is the designed state, and results carry their span.
const paused = { ...base, status: "PAUSED", latestRisk: null, latestDecision: null, latestSignal: null };
test("COLLECT_ONLY with a paused loop is worded neutrally and says why; without the flag nothing changes", () => {
  const on = buildLearningScreen(paused, { collectOnly: true });
  assert.equal(on.headline, "수집 전용이라 판단은 쉬어요");
  assert.equal(on.tone, "NORMAL");
  assert.match(on.sub, /주문이 꺼져 있어서 판단은 0건/);
  const off = buildLearningScreen(paused);
  assert.equal(off.headline, "학습이 잠시 쉬고 있어요");
  assert.equal(off.tone, "ATTENTION");
  assert.equal(buildLearningScreen(paused, { collectOnly: false }).headline, "학습이 잠시 쉬고 있어요");
});

test("the COLLECT_ONLY wording never hides a halt, an error, a risk block or missing data", () => {
  assert.equal(buildLearningScreen({ ...paused, status: "HALTED" }, { collectOnly: true }).tone, "LOSS");
  assert.equal(buildLearningScreen({ ...paused, status: "ERROR" }, { collectOnly: true }).headline, "학습에 오류가 있어요");
  const blocked = buildLearningScreen({ ...paused, latestRisk: { status: "FAIL", reason: "CONSECUTIVE_LOSS_LIMIT" } }, { collectOnly: true });
  assert.equal(blocked.tone, "ATTENTION");
  assert.equal(blocked.headline, "학습이 잠시 쉬고 있어요");
  assert.match(blocked.narrowest, /CONSECUTIVE_LOSS_LIMIT/);
  for (const dataSource of ["NOT_CONFIGURED", "UNAVAILABLE", "PROJECTION_ABSENT"]) {
    const m = buildLearningScreen({ ...paused, dataSource }, { collectOnly: true });
    assert.equal(m.headline, "학습 정보를 받지 못했어요");
    assert.equal(m.periodLabel, null);
    assert.equal(m.rows.length, 0);
  }
  const halted = buildLearningScreen({ ...paused, halt: { code: "X" } }, { collectOnly: true });
  assert.equal(halted.headline, "학습이 잠시 쉬고 있어요", "a server halt explanation is not the designed COLLECT_ONLY pause");
});

test("the result rows carry the span of the server's account events in KST, or say the span is unknown", () => {
  const at = (iso) => ({ occurredAt: Date.parse(iso), account: { equity: 1, realizedPnL: -1, unrealizedPnL: 0 } });
  const span = buildLearningScreen({ ...paused, timeline: [at("2026-10-14T20:00:00Z"), { occurredAt: Date.parse("2026-11-01T00:00:00Z") }, at("2026-11-02T14:59:00Z")] });
  assert.equal(span.periodLabel, "측정 기간 2026-10-15 ~ 2026-11-02", "20:00Z is 05:00 KST of the next day");
  assert.equal(buildLearningScreen({ ...paused, timeline: [at("2026-11-02T01:00:00Z")] }).periodLabel, "측정 기간 2026-11-02");
  assert.equal(buildLearningScreen({ ...paused, timeline: [{ occurredAt: Date.parse("2026-11-01T00:00:00Z") }] }).periodLabel, "측정 기간을 알 수 없어요 · 0은 기록이 없다는 뜻일 수 있어요", "no account or fill event: the span is not guessed");
  assert.equal(buildLearningScreen(paused).periodLabel, "측정 기간을 알 수 없어요 · 0은 기록이 없다는 뜻일 수 있어요");
});

test("the span covers fill events too, and the zero-decision sentence is never said over older decisions", () => {
  const fill = (iso) => ({ occurredAt: Date.parse(iso), fill: { fee: 1 } });
  const acct = (iso) => ({ occurredAt: Date.parse(iso), account: { equity: 1, realizedPnL: -1, unrealizedPnL: 0 } });
  assert.equal(buildLearningScreen({ ...paused, timeline: [acct("2026-11-02T01:00:00Z"), fill("2026-11-05T01:00:00Z")] }).periodLabel, "측정 기간 2026-11-02 ~ 2026-11-05");
  assert.match(buildLearningScreen(paused, { collectOnly: true }).sub, /판단은 0건/);
  for (const state of [{ ...paused, latestDecision: { action: "BUY" } }, { ...paused, dataSource: "LOCAL_FALLBACK" }, { ...paused, timeline: [{ occurredAt: 1, decision: { action: "HOLD" } }] }]) {
    const sub = buildLearningScreen(state, { collectOnly: true }).sub;
    assert.doesNotMatch(sub, /0건/);
    assert.match(sub, /지금은 판단하지 않아요/);
  }
});

test("App and the learning view pass the COLLECT_ONLY fact from the server snapshot and show the span", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  const app = read("apps/mobile/App.tsx");
  assert.equal((app.match(/<PaperShadowMonitorView paper=\{paperLearningState\} collectOnly=\{!paperProjectionPending && isCollectOnlyObservation\(snapshot\)\}/g) || []).length, 2, "both render sites");
  const view = read("apps/mobile/src/learningView.tsx");
  assert.match(view, /buildLearningScreen\(props\.paper, \{ collectOnly: collectOnly === true \}\)/);
  assert.match(view, /testID="learning-result-period"/);
  assert.match(view, /collectOnly, \.\.\.monitorProps/, "the flag is not forwarded to the monitor");
});
