const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const html = readFileSync(join(process.cwd(), "apps/desktop/renderer/index.html"), "utf8");
const script = readFileSync(join(process.cwd(), "apps/desktop/renderer/renderer.js"), "utf8");
const css = readFileSync(join(process.cwd(), "apps/desktop/renderer/styles.css"), "utf8");

test("canonical renderer exposes PAPER, live-disabled and read-only NUSA state surfaces", () => {
  assert.match(html, /data-runtime-owner="canonical"/);
  assert.match(html, /PAPER · 실거래 비활성/);
  assert.match(html, /실거래 주문을 전송하지 않습니다/);
  assert.match(html, /REAL\/LIVE 상태를 추론하거나 활성화하지 않습니다/);
  assert.match(html, /실제 runtime이 제공하는 전략·자동화·시장 연결 상태만 표시합니다/);
  assert.doesNotMatch(html, /data-(?:simple-)?(?:live|real)-(?:order|enable|activate)/i);
});

test("renderer explicitly supports all dashboard states and typed units", () => {
  for (const state of ["HEALTHY", "CAUTION", "BLOCKED", "NO_DATA"]) {
    assert.ok(html.includes(state) || script.includes(state) || css.includes(state.toLowerCase().replace("_", "-")));
  }
  assert.match(script, /cioPercent/);
  assert.match(script, /cioMoney/);
  assert.match(script, /bps/);
  assert.match(script, /ms/);
  assert.match(script, /renderCioUnavailable/);
});

test("polling is single-flight, at least five seconds, bounded, and cleaned up", () => {
  assert.match(script, /cioRefreshInFlight/);
  assert.match(script, /5_000/);
  assert.match(script, /Math\.min\(30_000/);
  assert.match(script, /beforeunload/);
  assert.match(script, /clearTimeout\(cioRefreshTimer\)/);
});

test("failed reads invalidate prior health instead of silently retaining it", () => {
  assert.match(script, /renderCioUnavailable\("UNAVAILABLE"\)/);
  assert.match(script, /blocked \? "BLOCKED" : "NO_DATA"/);
  assert.match(script, /className = `cio-status/);
});

test("unavailable sections never render numeric placeholder observations", () => {
  assert.match(script, /cioSectionAvailable/);
  assert.match(script, /section\.availability === "AVAILABLE"/);
  for (const section of ["portfolio", "opportunities", "strategies", "committee", "execution", "risk", "research"]) {
    assert.match(script, new RegExp(`cioSectionAvailable\\(snapshot\\.${section}\\)|cioSectionAvailable\\(${section}\\)`));
  }
  assert.match(script, /: "데이터 없음"/);
});
