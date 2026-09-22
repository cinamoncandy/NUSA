const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");

test("MASTER decorative hero asset registry is complete and semantically neutral", () => {
  const registry = read("apps/mobile/src/masterHeroAssets.ts");
  for (const path of [
    "home-planet.jpg",
    "market-globe.jpg",
    "signal-terrain.jpg",
    "signal-detail.jpg",
    "risk-sphere.jpg",
    "more-landscape.jpg",
  ]) assert.match(registry, new RegExp(path.replace(".", "\\.")));
  assert.match(registry, /no market or authority semantics/);
});

test("Risk and More render MASTER imagery without fabricating metrics or authority", () => {
  const risk = read("apps/mobile/src/riskView.tsx");
  const more = read("apps/mobile/src/moreMenuView.tsx");
  assert.match(risk, /MasterHeroImage asset="riskSphere"/);
  assert.match(risk, /PORTFOLIO VAR" value="—"/);
  assert.match(risk, /MAX DRAWDOWN" value="—"/);
  assert.match(risk, /SHARPE \(ANN\.\)" value="—"/);
  assert.match(more, /MasterHeroImage asset="moreLandscape"/);
  assert.match(more, /PAPER ONLY/);
  assert.match(more, /AI ZERO AUTHORITY/);
  assert.match(more, /REAL DATA ONLY/);
});
