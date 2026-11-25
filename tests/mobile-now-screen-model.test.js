"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const SRC = path.join(__dirname, "..", "apps", "mobile", "src");
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const src = fs.readFileSync(path.join(SRC, `${name}.ts`), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod.exports;
  new Function("module", "exports", "require", out)(mod, mod.exports, (id) => load(id.replace(/^\.\//, "")));
  return mod.exports;
}
const { buildNowScreen } = load("nowScreenModel");

const base = {
  phase: "CONNECTED", phaseHeadline: "시스템이 정상 작동 중", phaseDetail: "", staleLabel: null,
  equity: 9781, totalPnl: -219, startingEquity: 10000, orderReasonText: null, whyLines: [],
  decisionCount: 3680, paperOrderCount: 6, fillCount: 6,
};

test("healthy: one calm sentence, loss in red with percent, order count in lime", () => {
  const m = buildNowScreen(base);
  assert.equal(m.tone, "NORMAL");
  assert.equal(m.headline, "모두 정상이에요");
  assert.equal(m.dim, false);
  assert.equal(m.equity, "₩9,781");
  assert.equal(m.delta, "시작보다 −₩219 (−2.2%)");
  assert.equal(m.deltaTone, "LOSS");
  assert.deepEqual(m.stats.map((s) => [s.label, s.value, s.tone]), [["판단", "3,680", "NORMAL"], ["주문", "6", "ORDER"], ["체결", "6", "NORMAL"]]);
});

test("stale values never read as healthy and are dimmed", () => {
  const m = buildNowScreen({ ...base, staleLabel: "마지막 확인 2분 전" });
  assert.equal(m.tone, "ATTENTION");
  assert.equal(m.dim, true);
  assert.match(m.sub, /마지막 확인 2분 전/);
});

test("halt is red and keeps the runtime's own headline; unverified phases are amber", () => {
  assert.equal(buildNowScreen({ ...base, phase: "HALTED", phaseHeadline: "안전 정지 중" }).tone, "LOSS");
  assert.equal(buildNowScreen({ ...base, phase: "HALTED", phaseHeadline: "안전 정지 중" }).headline, "안전 정지 중");
  for (const phase of ["LAUNCH", "AUTHENTICATION", "RECOVERING", "DEGRADED"]) {
    const m = buildNowScreen({ ...base, phase, phaseHeadline: "PAPER 서버\n연결 필요" });
    assert.equal(m.tone, "ATTENTION", phase);
    assert.equal(m.dim, true, phase);
    assert.ok(!m.headline.includes("\n"));
  }
});

test("unknown money and counts show a dash, never zero or a colour", () => {
  const m = buildNowScreen({ ...base, equity: null, totalPnl: null, startingEquity: null, decisionCount: null, paperOrderCount: null, fillCount: null });
  assert.equal(m.equity, "—");
  assert.equal(m.delta, null);
  assert.equal(m.deltaTone, "MUTED");
  assert.deepEqual(m.stats.map((s) => s.value), ["—", "—", "—"]);
});

test("why joins the order reason with the decision explanation", () => {
  const m = buildNowScreen({ ...base, orderReasonText: "안전장치가 매수를 막았어요.", whyLines: ["연속 손실 한도", " "] });
  assert.equal(m.why, "안전장치가 매수를 막았어요. 연속 손실 한도");
});

test("a healthy COLLECT_ONLY server reads as watching without orders, not as 'all normal'; every other phase is unchanged", () => {
  const collect = buildNowScreen({ ...base, collectOnly: true });
  assert.equal(collect.headline, "주문 없이 지켜보는 중이에요");
  assert.equal(collect.sub, "연구는 데이터를 모으는 중이에요", "the safety facts are in the top band and the chip; the line says what is happening");
  assert.equal(collect.dim, false);
  assert.equal(buildNowScreen({ ...base }).headline, "모두 정상이에요", "without the flag nothing changes");
  assert.equal(buildNowScreen({ ...base, collectOnly: false }).headline, "모두 정상이에요");
  for (const phase of ["LAUNCH", "AUTHENTICATION", "RECOVERING", "DEGRADED", "HALTED"]) {
    const m = buildNowScreen({ ...base, phase, phaseHeadline: "H", phaseDetail: "D", collectOnly: true });
    assert.equal(m.headline, "H", `${phase} keeps its own headline`);
    assert.equal(m.sub, "D");
  }
  const stale = buildNowScreen({ ...base, staleLabel: "마지막 확인 2분 전", collectOnly: true });
  assert.equal(stale.headline, "최근 값을 보여주고 있어요", "a cached value is never shown as the live collect-only state");
});

test("source pin: nowView passes the collect-only flag to both the screen model and the status chip", () => {
  const view = fs.readFileSync(path.join(SRC, "nowView.tsx"), "utf8");
  assert.equal((view.match(/collectOnly: fieldInput\.collectOnly === true/g) ?? []).length, 2, "one for buildNowScreen and one for nowStatusChip");
  assert.match(view, /buildHomeFieldInput\(\{ snapshot: stale \? null : snapshot,/, "a cached snapshot never reaches the flag");
});

test("the zero note appears only for a healthy live COLLECT_ONLY server that really counted zero", () => {
  const zero = { ...base, decisionCount: 0, paperOrderCount: 0, fillCount: 0, collectOnly: true };
  assert.equal(buildNowScreen(zero).countNote, "수집 전용이라 0건이 정상이에요");
  assert.equal(buildNowScreen({ ...zero, decisionCount: null }).countNote, null, "no count: nothing claimed");
  assert.equal(buildNowScreen({ ...zero, decisionCount: 3 }).countNote, null, "a real decision removes the note");
  assert.equal(buildNowScreen({ ...zero, collectOnly: false }).countNote, null, "without COLLECT_ONLY zero is not explained away");
  assert.equal(buildNowScreen({ ...zero, staleLabel: "마지막 확인 2분 전" }).countNote, null, "a cached value never carries it");
  assert.equal(buildNowScreen({ ...zero, phase: "DEGRADED", phaseHeadline: "H", phaseDetail: "D" }).countNote, null);
  assert.equal(buildNowScreen({ ...zero, phase: "HALTED", phaseHeadline: "H", phaseDetail: "D" }).countNote, null);
  assert.equal(buildNowScreen({ ...zero, phase: "ATTENTION", phaseHeadline: "H", phaseDetail: "D" }).countNote, null, "an attention state never gets the calm explanation");
});

test("source pin: the note is hidden while blocked and the big number is 64 px", () => {
  const view = fs.readFileSync(path.join(SRC, "nowView.tsx"), "utf8");
  assert.match(view, /countNote=\{blocked \? null : model\.countNote\}/);
  const inst = fs.readFileSync(path.join(SRC, "instrumentNow.tsx"), "utf8");
  assert.match(inst, /<Odometer value=\{decisionCount\} size=\{64\}/);
});

test("source pin: on 지금 the decision number comes before the sphere, and the label says the server counts (not 'LIVE')", () => {
  const inst = fs.readFileSync(path.join(SRC, "instrumentNow.tsx"), "utf8");
  assert.ok(inst.indexOf("style={styles.countWrap}") < inst.indexOf("<LatticeSphere "), "number first, above the fold");
  assert.ok(inst.indexOf("<LatticeSphere ") < inst.indexOf("<GlassPanel style={styles.ledger}>"));
  assert.match(inst, /right=\{live \? "서버 집계" : "—"\}/);
  assert.doesNotMatch(inst, /"LIVE"/, "no pink LIVE word next to a 'LIVE locked' band");
});
