// Guards the presentation boundary that makes a future UI redesign a presenter swap.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("App imports every presentation module only through the presentation boundary", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /from "\.\/src\/presentation"/);
  // Any React (.tsx) module under src is presentation; App must reach all of them via the boundary.
  const direct = [...app.matchAll(/from "\.\/src\/([A-Za-z0-9]+)"/g)].map((m) => m[1])
    .filter((name) => name !== "presentation" && fs.existsSync(path.join(root, "apps/mobile/src", `${name}.tsx`)));
  assert.deepEqual(direct, [], `import these via src/presentation: ${direct.join(", ")}`);
  const presentation = read("apps/mobile/src/presentation.tsx");
  for (const presenter of ["HomeView", "PaperShadowMonitorView", "LiveReadinessMonitorView", "MoreMenuView", "TabTransition", "PortfolioView", "NotificationView", "SettingsView", "OrderHistoryView", "StrategiesView", "MoreDetailView", "PrimaryNavigation", "ThemeProvider"]) {
    assert.match(presentation, new RegExp(`export \\{ ${presenter}\\b`), presenter);
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
