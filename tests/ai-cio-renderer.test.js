const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const html = readFileSync(join(process.cwd(), "apps/desktop/renderer/index.html"), "utf8");
const script = readFileSync(join(process.cwd(), "apps/desktop/renderer/renderer.js"), "utf8");
const css = readFileSync(join(process.cwd(), "apps/desktop/renderer/styles.css"), "utf8");

test("renderer contains PAPER and live-disabled read-only command center sections", () => {
  assert.match(html, /id="ai-cio-dashboard"/);
  assert.match(html, /PAPER \/ DRY_RUN/);
  assert.match(html, /LIVE TRADING DISABLED/);
  for (const section of ["System Status", "Portfolio", "Opportunity", "Strategy Health", "Investment Committee", "Execution", "Risk", "Research", "Warnings"]) {
    assert.match(html, new RegExp(section));
  }
  assert.match(html, /aria-label="AI CIO [^"]+"/);
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
