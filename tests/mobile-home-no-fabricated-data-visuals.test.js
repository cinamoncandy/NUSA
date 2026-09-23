const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileSrc = path.resolve(__dirname, "../apps/mobile/src");
const read = (file) => fs.readFileSync(path.join(mobileSrc, file), "utf8");

// The concept board is the visual standard, but it cannot authorise a claim the runtime cannot
// make. A chart-like mark whose geometry is a constant renders the same whether the runtime has
// data or not — including next to a value that reads "Waiting" — so it asserts a trend that no
// verified series supports. Missing data is stated, never drawn.
test("HOME status cards draw no trend that is not backed by data", async (t) => {
  const home = read("homeView.tsx");

  await t.test("status cards carry no chart-like mark, only a label and the real state", () => {
    // Scoped deliberately to the status cards. The hero's mountains and the globe's landmasses are
    // illustration and are rotated too; nobody reads a mountain silhouette as a market trend. A
    // line drawn inside a card captioned "Market" is a different claim.
    for (const id of ["home-market-status", "home-paper-status", "home-ai-judgement"]) {
      const start = home.indexOf(`testID="${id}"`);
      assert.ok(start > 0, `${id} must exist`);
      const card = home.slice(start, home.indexOf("</Pressable>", start));
      assert.doesNotMatch(card, /rotate:|Spark|Line|Chart|Trend|Sparkline/i,
        `${id} must not draw a trend: its geometry would be constant while its value can read "Waiting"`);
    }
  });

  await t.test("the removed sparkline decoration does not return", () => {
    for (const marker of ["miniSpark", "miniSparkLine", "miniSparkLine2"]) {
      assert.equal(home.includes(marker), false, `${marker} drew a constant two-segment line on cards that may read "Waiting"`);
    }
  });

  await t.test("every status card still states its real runtime state", () => {
    for (const id of ["home-market-status", "home-paper-status", "home-ai-judgement"]) {
      assert.ok(home.includes(`testID="${id}"`), `${id} must remain a real, reachable card`);
    }
    assert.match(home, /"Waiting"/, "an unverified runtime state must be stated in words");
  });

  await t.test("missing money and rate values fail closed to an em dash", () => {
    assert.match(home, /function won\(value: number \| null \| undefined\): string \{\s*return value == null \|\| !Number\.isFinite\(value\) \? "—"/);
    assert.match(home, /function pct\(value: number \| null \| undefined\): string \{\s*if \(value == null \|\| !Number\.isFinite\(value\)\) return "—";/);
  });
});
