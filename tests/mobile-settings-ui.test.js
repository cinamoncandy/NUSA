const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings UI exposes persisted configuration, Paper safety, reset, and required states", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "settingsView.tsx"), "utf8");
  assert.match(source, /settings-theme/);
  assert.match(source, /settings-locale/);
  assert.match(source, /settings-notifications/);
  assert.match(source, /settings-mode/);
  assert.match(source, /settings-about/);
  assert.match(source, /settings-reset/);
  assert.match(source, /settings-loading/);
  assert.match(source, /settings-error/);
  assert.match(source, /PAPER/);
  assert.match(source, /Live trading is disabled/);
  assert.match(source, /SettingsRepository/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw/);
  const more = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "moreView.tsx"), "utf8");
  assert.match(more, /SettingsView/);
  assert.match(more, /OrderHistoryView/);
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  assert.match(app, /<MoreView/);
  assert.match(app, /settingsRepository/);
});
