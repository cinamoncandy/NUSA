const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHaltExplanation, haltCauseFromSnapshot } = require("../dist/apps/mobile/src/haltReasonModel.js");
const { buildPaperLearningScreen } = require("../dist/apps/mobile/src/paperLearningScreen.js");
const { buildHomeFieldInput } = require("../dist/apps/mobile/src/homeFieldInput.js");
const { buildIntelligenceField } = require("../dist/apps/mobile/src/intelligenceFieldModel.js");
const { buildHomeStatusRail } = require("../dist/apps/mobile/src/homeStatusRail.js");

test("a halt explanation exists only while the server status is HALTED", () => {
  for (const status of ["RUNNING", "PAUSED", "ERROR"]) assert.equal(buildHaltExplanation(status, { runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"] }), null);
  assert.ok(buildHaltExplanation("HALTED", null));
});

test("each server halt reason is explained in plain Korean; an unknown code never reaches the owner as a raw code", () => {
  const e = buildHaltExplanation("HALTED", { runtimeHaltReasons: ["KILL_SWITCH_ACTIVE", "AI_P0_OPEN", "AI_P0_UNVERIFIABLE", "DASHBOARD_FAULTED", "NEW_CODE_X"] });
  assert.deepEqual([...e.lines], [
    "비상 정지 스위치가 켜져 있습니다",
    "AI 중대 경보(P0)가 열려 있습니다",
    "AI 중대 경보(P0) 상태를 확인할 수 없습니다",
    "서버 대시보드가 장애 상태입니다",
    "서버가 알 수 없는 정지 사유를 보냈습니다",
  ]);
  assert.equal(e.summary, "비상 정지 스위치 · AI 중대 경보 · 경보 확인 불가 · 서버 장애 · 알 수 없는 사유");
  assert.equal(e.diagnostic, null);
  assert.ok(!e.lines.join(" ").includes("NEW_CODE_X"));
});

test("the kill switch flag alone is explained once, even when the reason list also carries it", () => {
  assert.deepEqual([...buildHaltExplanation("HALTED", { killSwitchActive: true }).lines], ["비상 정지 스위치가 켜져 있습니다"]);
  assert.equal(buildHaltExplanation("HALTED", { killSwitchActive: true, runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"] }).lines.length, 1);
});

test("a latched server error is translated; the raw value is kept only as a bounded diagnostic", () => {
  const cases = [
    ["PAPER_EXECUTION_FAILED", "모의 주문 실행이 실패했습니다"],
    ["PUBLIC_ORDERBOOK_SNAPSHOT_UNAVAILABLE", "호가 정보를 가져오지 못했습니다"],
    ["PAPER_ORDERBOOK_UNRECONCILED", "호가 정보가 서로 맞지 않아 확인 중입니다"],
    ["PAPER_ORDERBOOK_OBSERVATION_REJECTED", "호가 관측값이 거절되었습니다"],
    ["PAPER_MARKET_OBSERVATION_REJECTED:STALE", "시세 관측값이 거절되었습니다"],
    ["PUBLIC_MARKET_DISCONNECTED", "시세 연결 상태가 정상이 아닙니다"],
    ["SOMETHING_NEW_AND_INTERNAL", "서버가 운영 중 오류를 기록했습니다"],
  ];
  for (const [raw, korean] of cases) {
    const e = buildHaltExplanation("HALTED", { lastError: raw });
    assert.equal(e.lines[0], `서버가 기록한 마지막 오류: ${korean}`);
    assert.ok(!e.lines.join(" ").includes(raw), "the owner-facing lines never carry the raw code");
    assert.equal(e.diagnostic, raw);
    assert.equal(e.summary, "서버 오류");
  }
  const long = buildHaltExplanation("HALTED", { lastError: `X${"y".repeat(500)}` });
  assert.ok(long.diagnostic.length <= 160);
});

test("per-tick market rejections are diagnostics, not a halt cause; a missing cause is stated as unknown", () => {
  const diag = buildHaltExplanation("HALTED", { lastError: "PUBLIC_MARKET_EVENT_REJECTED:STALE" });
  assert.deepEqual([...diag.lines], ["서버가 정지 사유를 보내지 않았습니다. 이 앱에서는 원인을 확인할 수 없습니다."]);
  assert.equal(diag.diagnostic, null);
  for (const evidence of [null, undefined, {}, { runtimeHaltReasons: "KILL_SWITCH_ACTIVE" }, { runtimeHaltReasons: [42, null, "bad code"] }, { lastError: 7 }]) {
    const e = buildHaltExplanation("HALTED", evidence);
    assert.equal(e.summary, "사유 확인 불가");
  }
  assert.ok(Object.isFrozen(buildHaltExplanation("HALTED", null)));
});

test("PAPER screen model carries the explanation only while HALTED and only from the server's own fields", () => {
  const halted = buildPaperLearningScreen([], "HALTED", "SERVER_STREAM", { runtimeHaltReasons: ["AI_P0_OPEN"], killSwitchActive: false, lastError: null });
  assert.deepEqual([...halted.halt.lines], ["AI 중대 경보(P0)가 열려 있습니다"]);
  assert.equal(buildPaperLearningScreen([], "RUNNING", "SERVER_STREAM", { runtimeHaltReasons: ["AI_P0_OPEN"] }).halt, null);
  assert.equal(buildPaperLearningScreen([], "HALTED", "SERVER_STREAM").halt.summary, "사유 확인 불가", "no evidence passed: unknown, not guessed");
});

test("HOME surfaces the same cause: field input, headline detail and status rail", () => {
  const snapshot = (operations) => ({ health: "DEGRADED", readyForPaperOperations: false, dashboard: { killSwitchActive: false }, operations: { runtimeState: "HALTED", ...operations } });
  const source = (snap) => ({ snapshot: snap, readOnlyError: null, notConfigured: null, sessionRecovering: false, publicMarketStale: false });
  const snap = snapshot({ runtimeHaltReasons: ["AI_P0_OPEN", "DASHBOARD_FAULTED"], heartbeat: { decisionCount: 1, paperOrderCount: 0 } });
  const input = { ...buildHomeFieldInput(source(snap)), haltCause: haltCauseFromSnapshot(snap) };
  assert.equal(input.haltActive, true);
  assert.equal(input.haltCause, "AI 중대 경보 · 서버 장애");
  const field = buildIntelligenceField(input);
  assert.equal(field.phase, "HALTED");
  assert.match(field.detail, /사유: AI 중대 경보 · 서버 장애/);
  const rail = buildHomeStatusRail({ paperState: "DOWN", paperMode: "PAPER", killSwitchActive: false, snapshotGeneratedAtMs: 1, feedStale: false, feedObservedAtMs: 1, nowMs: 2, hasDailyPnlBasis: false, haltCause: input.haltCause });
  assert.equal(rail.systemLine, "PAPER 중단(AI 중대 경보 · 서버 장애)");
});

test("HOME says nothing extra when not halted, and keeps the old wording when no cause is known", () => {
  assert.equal(haltCauseFromSnapshot({ dashboard: { killSwitchActive: false }, operations: { runtimeState: "RUNNING" } }), null);
  assert.equal(haltCauseFromSnapshot(null), null);
  const base = { paperState: "DOWN", paperMode: "FAULTED", killSwitchActive: false, snapshotGeneratedAtMs: 1, feedStale: false, feedObservedAtMs: 1, nowMs: 2, hasDailyPnlBasis: false };
  assert.equal(buildHomeStatusRail(base).systemLine, "PAPER 중단");
  assert.equal(buildHomeStatusRail({ ...base, haltCause: "  " }).systemLine, "PAPER 중단");
  assert.equal(buildHomeStatusRail({ ...base, paperMode: "PAPER", paperState: "READY", killSwitchActive: true }).systemLine, "PAPER 중단(킬 스위치)");
  const killed = { health: "DEGRADED", readyForPaperOperations: false, dashboard: { killSwitchActive: true }, operations: { runtimeState: "RUNNING" } };
  assert.equal(haltCauseFromSnapshot(killed), "비상 정지 스위치");
  assert.ok(buildIntelligenceField({ ...buildHomeFieldInput({ snapshot: killed, readOnlyError: null, notConfigured: null, sessionRecovering: false, publicMarketStale: false }), haltCause: haltCauseFromSnapshot(killed) }).detail.includes("사유: 비상 정지 스위치"));
});

test("a PAPER account save failure is explained in Korean, with a cause hint only when the server names one", () => {
  const { buildHaltExplanation } = require("../dist/apps/mobile/src/haltReasonModel.js");
  const of = (lastError) => buildHaltExplanation("HALTED", { lastError });
  assert.equal(of("paper account persistence failed").lines[0], "서버가 기록한 마지막 오류: 모의 계좌 상태를 서버가 저장하지 못했습니다");
  assert.match(of("paper account persistence failed: SQLITE_READONLY attempt to write a readonly database").lines[0], /저장소가 읽기 전용입니다/);
  assert.match(of("paper account persistence failed: paper writer lease lost").lines[0], /쓰기 권한/);
  assert.match(of("paper account persistence failed: ENOSPC no space left on device").lines[0], /저장 공간이 부족/);
  assert.match(of("paper account persistence failed: SQLITE_BUSY database is locked").lines[0], /잠겨 있습니다/);
  assert.match(of("paper account persistence failed: paper fill ledger does not reconcile").lines[0], /장부가/);
  assert.equal(of("paper account persistence failed: something unheard of").lines[0], "서버가 기록한 마지막 오류: 모의 계좌 상태를 서버가 저장하지 못했습니다", "an unknown cause is not guessed");
  assert.equal(of("paper account persistence failed: SQLITE_READONLY attempt to write a readonly database").diagnostic, "paper account persistence failed: SQLITE_READONLY attempt to write a readonly database", "the raw text stays in the advanced line");
});
