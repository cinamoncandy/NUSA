const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(process.cwd(), "apps/mobile/src/portfolioView.tsx"), "utf8");

test("SUPERVISE keeps the REAL_READ_ONLY baseline immediately after the PAPER operating summary", () => {
  const summary = source.indexOf('testID="portfolio-supervisor-summary"');
  const readOnly = source.indexOf("<UpbitReadOnlySection", summary);
  const allocation = source.indexOf('testID="portfolio-allocation-rail"', summary);

  assert.ok(summary >= 0, "PAPER operating summary must remain present");
  assert.ok(readOnly > summary, "REAL_READ_ONLY baseline must follow the PAPER summary");
  assert.ok(allocation > readOnly, "PAPER allocation detail must not push the real-account baseline down the screen");
});

test("SUPERVISE does not repeat the PAPER result in a second hero and metric strip", () => {
  assert.equal(source.includes('testID="portfolio-summary"'), false, "redundant PAPER hero must stay removed");
  assert.equal(source.includes("MetricTile"), false, "duplicated PAPER metric strip must stay removed");
  assert.match(source, /label="PAPER 평가자산"/);
  assert.match(source, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 합산하지 않습니다\./);
  assert.match(source, /testID="portfolio-upbit-read-only"/);
});
