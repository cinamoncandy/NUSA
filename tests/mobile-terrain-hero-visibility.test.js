const test = require("node:test");
const assert = require("node:assert/strict");
const { createTheme } = require("../dist/apps/mobile/src/designSystem.js");

// Same relative-luminance / contrast-ratio math the WCAG contrast tests elsewhere in this repo use.
const hex = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`not a 6-digit hex color: ${value}`);
  return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
};
const relativeLuminance = ([r, g, b]) => {
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrastRatio = (a, b) => {
  const [hi, lo] = [relativeLuminance(hex(a)), relativeLuminance(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the HOME terrain/signal hero uses geometry thick enough to actually register", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "apps/mobile/src/components.tsx"), "utf8");
  // Issue #536 names this the visual hero of HOME. It previously rendered as 1px lines at low
  // opacity around an 8px dot -- close to empty space at normal viewing distance, in every design
  // preset, which is how a real redesign kept reading as "nothing changed" on a physical device.
  assert.doesNotMatch(source, /terrainPlane:\s*\{\s*position:\s*"absolute",\s*height:\s*1\s*[,}]/, "terrain strokes must not regress to 1px");
  assert.match(source, /terrainConvergence:\s*\{[^}]*width:\s*1[0-9],\s*height:\s*1[0-9]/, "the convergence node must be a real focal point, not a pinprick");
});

test("the hero graphic's elements are clearly visible against the HOME background in every mode and preset", () => {
  // WCAG's 3:1 non-text minimum is the floor for a decorative element; this hero graphic exists to
  // be seen, so it is held well above that floor rather than merely clearing it. Checked across
  // both modes and both presets: aiSignalEnd previously used one fixed value regardless of mode
  // and fell to ~1.5:1 against a light background specifically, which made the HOME hero's central
  // convergence node nearly invisible for anyone not in dark mode.
  const minimumHeroContrast = 4;
  for (const mode of ["dark", "light"]) {
    for (const preset of ["classic", "master"]) {
      const theme = createTheme(mode, preset).colors;
      for (const [label, color] of [
        ["terrain", theme.terrain],
        ["aiSignalStart", theme.aiSignalStart],
        ["aiSignalMid", theme.aiSignalMid],
        ["aiSignalEnd", theme.aiSignalEnd],
      ]) {
        const ratio = contrastRatio(theme.background, color);
        assert.ok(ratio >= minimumHeroContrast, `${mode}/${preset} ${label} contrast is ${ratio.toFixed(2)}, expected >= ${minimumHeroContrast}`);
      }
    }
  }
});
