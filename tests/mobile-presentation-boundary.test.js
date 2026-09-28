// Guards the presentation boundary that makes a future UI redesign a presenter swap.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("App imports screen presenters only through the presentation boundary", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /from "\.\/src\/presentation"/);
  for (const direct of ["homeView", "paperShadowMonitorView", "liveReadinessMonitorView", "moreMenuView", "tabTransition"]) {
    assert.doesNotMatch(app, new RegExp(`from "\\./src/${direct}"`), `${direct} must be imported via src/presentation`);
  }
  const presentation = read("apps/mobile/src/presentation.tsx");
  for (const presenter of ["HomeView", "PaperShadowMonitorView", "LiveReadinessMonitorView", "MoreMenuView", "TabTransition"]) {
    assert.match(presentation, new RegExp(`export \\{ ${presenter}\\b`));
  }
  assert.match(presentation, /id: "field-v1", status: "INTERIM"/);
});

test("field motion timing comes from tokens, not literals", () => {
  for (const file of ["intelligenceField.tsx", "fieldHeader.tsx", "tabTransition.tsx"]) {
    const source = read(`apps/mobile/src/${file}`);
    assert.doesNotMatch(source, /duration: \d/, `${file} must use fieldMotion tokens`);
    assert.match(source, /fieldMotion\./);
  }
});

test("the UI architecture guide documents the redesign path", () => {
  const doc = read("docs/UI_ARCHITECTURE.md");
  for (const heading of ["## Layers", "## How to ship a redesign", "## Test policy", "## Migration backlog"]) assert.ok(doc.includes(heading), heading);
});
