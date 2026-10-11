const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { holoFillMarker, holoChipPlacement, HOLO_COLORS, FLOW_NODES, FLOW_PAPER } = require("../dist/apps/mobile/src/holoModel.js");
const { fieldHero, createTheme } = require("../dist/apps/mobile/src/designSystem.js");
const { vitalUsesHeroAccent } = require("../dist/apps/mobile/src/homeVitalsModel.js");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8");

test("the order marker and the market chip sit inside the hero canvas for every plausible size and label", () => {
  const m = holoFillMarker(300);
  const paper = FLOW_NODES[FLOW_PAPER];
  assert.ok(Math.abs(m.x - 300 * paper.x) < 1e-9 && Math.abs(m.y - 300 * (paper.y - paper.r)) < 1e-9, "the marker is the foot of the order's beam, on top of the paper cluster");
  for (const size of [200, 300, 360]) {
    const marker = holoFillMarker(size);
    assert.ok(marker.x > size / 2 && marker.x < size && marker.y > 0 && marker.y < size, "right of centre, inside the canvas");
    for (const label of ["KRW-XRP", "KRW-BTC", "KRW-DOGE", "KRW-1INCH", "KRW-A", "KRW-ABCDEFGHIJKLMNOP"]) {
      const c = holoChipPlacement(size, label);
      assert.ok(c.left >= 0 && c.left + c.width <= size, `${label} stays inside ${size}`);
      assert.ok(c.top >= 0 && c.top < marker.y && c.width >= 16, "the chip sits above the beam's foot");
    }
  }
  const xrp = holoChipPlacement(300, "KRW-XRP");
  assert.ok(xrp.left >= holoFillMarker(300).x && xrp.left + xrp.width <= 300, "the chip sits just right of the beam when there is room");
});

test("the hero accent is the figure's own lime and is never a status colour", () => {
  const [r, g, b] = HOLO_COLORS.lime;
  assert.equal(fieldHero.lime.toLowerCase(), `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "same lime as the figure's active line and marker");
  const colors = createTheme("dark").colors;
  const dist = (a, c) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(c.slice(i, i + 2), 16)));
  for (const status of [colors.success, colors.warning, colors.danger]) assert.ok(dist(fieldHero.lime, status) >= 60, `lime stays distinct from ${status}`);
  assert.equal(colors.primary, "#E8F0F2", "calm-v1: the rest of the app is white on the dark ground; lime stays the hero/order accent");
});

test("only a healthy learning tile takes the hero accent; warnings and missing data keep their status colour", () => {
  assert.equal(vitalUsesHeroAccent({ id: "learning", tone: "ok" }), true);
  for (const tone of ["warn", "muted", "bad", undefined]) assert.equal(vitalUsesHeroAccent({ id: "learning", tone }), false, String(tone));
  for (const id of ["coin", "buy", "feed"]) assert.equal(vitalUsesHeroAccent({ id, tone: "ok" }), false, id);
});

test("the HOME hero block explains the new figure, shows the market chip only when nothing is wrong, and passes the market through", () => {
  const rings = read("decisionRings.tsx"), home = read("homeView.tsx");
  assert.match(rings, /판단마다 빛이 시장에서 장부까지 흐르고, 주문이 나가면 PAPER가 라임으로 점화합니다/);
  assert.ok(!/물결이 지나가고|바깥으로 퍼졌다|핵에서 빛이 퍼지고|벽의 한 줄이|지평선에서 빛이 밀려오고/.test(rings), "the old figures' descriptions are gone");
  assert.match(rings, /marketLabel != null && MARKET_CHIP\.test\(marketLabel\) && status == null/, "no chip while the runtime is held or halted");
  assert.match(rings, /color: fieldHero\.lime \}\]\} testID="home-decision-rings-orders"/);
  assert.match(home, /marketLabel=\{heroMarket\}/);
  assert.match(home, /vitalUsesHeroAccent\(vital\) \? fieldHero\.limeBorder : theme\.colors\.border/);
});
