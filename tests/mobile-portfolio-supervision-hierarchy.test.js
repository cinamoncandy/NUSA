const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("SUPERVISE keeps capital, exposure and PAPER accounting ahead of the REAL_READ_ONLY reference", () => {
  const summary = source.indexOf('testID="portfolio-supervisor-summary"');
  const allocation = source.indexOf('testID="portfolio-allocation-rail"', summary);
  const position = source.indexOf('kicker="PAPER EXPOSURE"', summary);
  const accounting = source.indexOf('testID="portfolio-account-breakdown"', summary);
  const readOnly = source.indexOf('testID="portfolio-upbit-read-only"', summary);

  assert.ok(summary >= 0, "PAPER operating summary must remain present");
  assert.ok(allocation > summary, "capital limits must follow the operating summary");
  assert.ok(position > allocation, "PAPER exposure must follow capital limits");
  assert.ok(accounting > position, "PAPER accounting must follow exposure");
  assert.ok(readOnly > accounting, "REAL_READ_ONLY must stay a separate reference after PAPER operating truth");
});

test("SUPERVISE uses one canonical capital strip and keeps REAL_READ_ONLY separate", () => {
  assert.equal(source.includes('testID="portfolio-summary"'), false, "redundant legacy PAPER hero must stay removed");
  assert.equal(source.includes("MetricTile"), false, "duplicated legacy metric tiles must stay removed");
  assert.match(source, /testID="portfolio-supervisor-summary"/);
  assert.match(source, /label: "PAPER EQUITY"/);
  assert.match(source, /label: "TOTAL PNL"/);
  assert.match(source, /label: "CASH"/);
  assert.match(source, /label: "EXPOSURE"/);
  assert.match(source, /kicker="PAPER ACCOUNTING"/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다\./);
  assert.match(source, /testID="portfolio-upbit-read-only"/);
  assert.match(source, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);
});
