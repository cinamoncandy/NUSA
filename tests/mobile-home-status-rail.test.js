"use strict";

// STEP-3B: HOME status-rail domain tests. Pure functions only — fixed
// timestamps, no wall-clock, no network, no credentials.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildHomeStatusRail,
} = require("../dist/apps/mobile/src/homeStatusRail.js");

const NOW = 1_700_000_000_000;

function input(overrides = {}) {
  return {
    paperState: "READY",
    paperMode: "PAPER",
    killSwitchActive: false,
    snapshotGeneratedAtMs: NOW - 12_000,
    feedStale: false,
    feedObservedAtMs: NOW - 12_000,
    nowMs: NOW,
    hasDailyPnlBasis: false,
    ...overrides,
  };
}

test("ready fresh feed reports normal risk with live freshness", () => {
  const rail = buildHomeStatusRail(input());
  assert.equal(rail.marketLine, "시장 온라인");
  assert.equal(rail.systemLine, "PAPER 정상");
  assert.equal(rail.risk, "NORMAL");
  assert.equal(rail.riskLabel, "정상");
  assert.equal(rail.freshnessLabel, "12초 전");
  assert.equal(rail.freshnessTone, "live");
  assert.equal(rail.pnlBasisLabel, "누적");
  assert.equal(rail.changesSupported, false);
});

test("degraded and stopped states elevate risk without hiding it", () => {
  assert.equal(buildHomeStatusRail(input({ paperState: "DEGRADED" })).risk, "ELEVATED");
  assert.equal(buildHomeStatusRail(input({ paperState: "DEGRADED" })).systemLine, "PAPER 저하");
  assert.equal(buildHomeStatusRail(input({ paperMode: "STOPPED" })).risk, "ELEVATED");
});

test("halted states report HIGH risk, never normal", () => {
  assert.equal(buildHomeStatusRail(input({ paperState: "DOWN" })).risk, "HIGH");
  assert.equal(buildHomeStatusRail(input({ paperMode: "FAULTED" })).risk, "HIGH");
  const kill = buildHomeStatusRail(input({ killSwitchActive: true }));
  assert.equal(kill.risk, "HIGH");
  assert.equal(kill.systemLine, "PAPER 중단(킬 스위치)");
});

test("unknown stays unknown — never rendered as low risk (failure tests)", () => {
  const unconfigured = buildHomeStatusRail(input({ paperState: "NOT_CONFIGURED", paperMode: null }));
  assert.equal(unconfigured.risk, "UNKNOWN");
  assert.equal(unconfigured.riskLabel, "확인 불가");
  assert.equal(unconfigured.systemLine, "PAPER 미연결");
  const unavailable = buildHomeStatusRail(input({ paperState: "UNAVAILABLE", paperMode: null }));
  assert.equal(unavailable.risk, "UNKNOWN");
  assert.notEqual(unavailable.risk, "NORMAL");
});

test("stale feed keeps its age visible with stale tone", () => {
  const rail = buildHomeStatusRail(input({ feedStale: true, snapshotGeneratedAtMs: NOW - 300_000 }));
  assert.equal(rail.marketLine, "시장 대기");
  assert.equal(rail.risk, "CAUTION");
  assert.equal(rail.freshnessLabel, "5분 전");
  assert.equal(rail.freshnessTone, "stale");
});

test("unverifiable timestamps yield null age, never a guessed one", () => {
  const rail = buildHomeStatusRail(input({ snapshotGeneratedAtMs: null, feedObservedAtMs: null }));
  assert.equal(rail.freshnessLabel, null);
  assert.equal(rail.freshnessTone, "unknown");
  const future = buildHomeStatusRail(input({ snapshotGeneratedAtMs: NOW + 60_000, feedObservedAtMs: NOW + 60_000 }));
  assert.equal(future.freshnessTone, "unknown");
});

test("snapshot timestamp is preferred over feed timestamp", () => {
  const rail = buildHomeStatusRail(input({ snapshotGeneratedAtMs: NOW - 5_000, feedObservedAtMs: NOW - 900_000 }));
  assert.equal(rail.freshnessLabel, "방금");
  assert.equal(rail.freshnessTone, "live");
});

test("오늘 is only allowed with proven daily basis", () => {
  assert.equal(buildHomeStatusRail(input({ hasDailyPnlBasis: true })).pnlBasisLabel, "오늘");
  assert.equal(buildHomeStatusRail(input({ hasDailyPnlBasis: false })).pnlBasisLabel, "누적");
});
