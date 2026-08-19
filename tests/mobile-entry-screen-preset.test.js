const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("the launch entry screen follows the active design preset instead of fixed geometry", () => {
  const app = read("apps/mobile/App.tsx");
  // Local entry is not persisted, so this screen is the first thing seen on every launch. While it
  // carried hardcoded geometry, changing the design preset left it byte-identical -- which is how
  // several shipped HOME redesigns could read as "nothing changed" to someone who never tapped
  // past it.
  assert.match(app, /getHomeVisualProfile/, "entry screen must consult the shared visual profile");
  assert.match(app, /const entryProfile = getHomeVisualProfile\(appTheme\.preset\)/);

  const entryScreen = app.split('if (authStatus !== "SIGNED_IN")')[1] ?? "";
  assert.ok(entryScreen, "entry screen render branch must exist");
  for (const token of [
    "entryProfile.screen.horizontalPadding",
    "entryProfile.screen.maxWidth",
    "entryProfile.density.contentGap",
    "entryProfile.type.body",
    "entryProfile.type.meta",
  ]) {
    assert.ok(entryScreen.includes(token), `entry screen must derive geometry from ${token}`);
  }
});

test("the entry screen keeps its PAPER-only disclosure while following the preset", () => {
  const app = read("apps/mobile/App.tsx");
  const entryScreen = app.split('if (authStatus !== "SIGNED_IN")')[1] ?? "";
  // Restyling must not quietly drop the boundary this screen exists to state.
  assert.match(entryScreen, /PAPER ONLY/);
  assert.match(entryScreen, /LIVE NONE/);
  assert.match(entryScreen, /계정 인증이 아닙니다/);
  assert.match(entryScreen, /testID="local-entry-submit"/);
});

test("classic and master resolve the entry screen to different geometry", () => {
  const profile = read("apps/mobile/src/homeVisualProfile.ts");
  // If both presets resolved to the same numbers the entry screen would still look frozen, so the
  // values this screen now reads must actually differ between presets.
  const classic = profile.split("classic:")[1].split("master:")[0];
  const master = profile.split("master:")[1];
  const horizontal = (source) => Number(/horizontalPadding:\s*(\d+)/.exec(source)[1]);
  const maxWidth = (source) => Number(/maxWidth:\s*(\d+)/.exec(source)[1]);
  const contentGap = (source) => Number(/contentGap:\s*(\d+)/.exec(source)[1]);
  assert.notEqual(horizontal(classic), horizontal(master));
  assert.notEqual(maxWidth(classic), maxWidth(master));
  assert.notEqual(contentGap(classic), contentGap(master));
});
