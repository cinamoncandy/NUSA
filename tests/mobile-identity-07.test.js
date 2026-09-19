const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTheme, buttonTokens } = require("../dist/apps/mobile/src/designSystem.js");

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const mode of ["light", "dark"]) {
  test(`identity 07 ${mode}: readable text, controls and independent status colors`, () => {
    const theme = createTheme(mode);
    for (const surface of ["background", "surface", "surfaceRaised", "surfaceSunken"]) {
      for (const text of ["text", "textMuted"]) {
        assert.ok(contrast(theme.colors[text], theme.colors[surface]) >= 4.5, `${text}/${surface}`);
      }
    }
    for (const tone of ["primary", "danger", "neutral"]) {
      const button = buttonTokens(theme, tone);
      assert.ok(contrast(button.foreground, button.background) >= 4.5, tone);
      assert.ok(button.minHeight >= 48);
    }
    assert.ok(theme.typography.body >= 16);
    assert.notEqual(theme.colors.primary, theme.colors.success);
    assert.notEqual(theme.colors.primary, theme.colors.danger);
    assert.ok(Object.isFrozen(theme.colors));
  });
}

test("HOME identity puts recovery before evidence and removes decorative activity simulation", () => {
  const home = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
  assert.ok(home.indexOf('testID="home-operational-notice"') < home.indexOf('testID="home-now"'));
  assert.match(home, /판단은 검증으로 쌓인다/);
  assert.doesNotMatch(home, /IntelligenceMotionField|LIVE INTELLIGENCE/);
  assert.match(home, /aiInsightAvailable = decisionSurface.aiInsightAvailable && !disconnected && readOnlyError == null/);
  assert.match(home, /onPress=\{onGoSettings\}/);
  assert.match(home, /LIVE NONE · AI ZERO AUTHORITY/);
  assert.doesNotMatch(home, /fetch\(|setInterval\(|Math.random\(/);
  assert.match(home, /heroDetail: \{[^\n]*fontSize: 16/);
});
