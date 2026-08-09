const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("design tokens expose every required token family", () => {
  const css = read("apps/desktop/renderer/tokens.css");
  for (const token of ["--color-bg", "--font-sans", "--space-4", "--space-96", "--radius-xl", "--shadow-xs", "--motion-normal", "--z-modal", "--opacity-overlay", "--breakpoint-lg"]) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-theme="contrast"/);
});

test("desktop loads tokens before component styles", () => {
  const html = read("apps/desktop/renderer/index.html");
  assert.ok(html.indexOf("tokens.css") < html.indexOf("styles.css"));
});

test("Tailwind and shadcn share the CSS variable theme", () => {
  const tailwind = read("tailwind.config.cjs");
  const shadcn = JSON.parse(read("components.json"));
  assert.match(tailwind, /hsl\(var\(--primary\)/);
  assert.equal(shadcn.tailwind.cssVariables, true);
  assert.equal(shadcn.tailwind.css, "apps/desktop/renderer/tokens.css");
  assert.match(tailwind, /--motion-normal/);
  assert.match(tailwind, /--radius-xl/);
  assert.match(tailwind, /--z-modal/);
  assert.match(tailwind, /screens: \{ sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem" \}/);
});

test("theme provider exposes dark and contrast themes without renderer business logic", () => {
  const provider = read("apps/desktop/renderer/theme-provider.js");
  assert.match(provider, /new Set\(\["dark", "contrast"\]\)/);
  assert.match(provider, /NUSATheme/);
  assert.doesNotMatch(provider, /electron|ipcRenderer|PaperBroker|ControlPlane/);
});

test("renderer styles use semantic variables rather than literal colors", () => {
  const styles = read("apps/desktop/renderer/styles.css");
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /\brgba?\(/i);
  assert.match(styles, /var\(--color-bg\)/);
  assert.match(styles, /var\(--color-primary\)/);
});

test("renderer JS avoids literal colors outside the documented resolveColorToken fallback", () => {
  // Regression: renderer.js and simple-ui.js each hardcoded a hex color directly into
  // context.strokeStyle / an SVG stroke attribute -- neither can consume var(--token) the way a
  // CSS property can, so DESIGN_SYSTEM.md's "no literal colors" rule had nothing to check them
  // against; this test previously only scanned styles.css. Neither literal matched any current
  // token value (tokens are HSL triples like "220 100% 62%", not hex), so a token change would
  // silently leave these two chart lines behind.
  //
  // The fix reads the resolved token at draw time via resolveColorToken(name, fallback). Its
  // second argument is a legitimate hex literal -- a documented degrade-gracefully value used
  // only if the CSS variable lookup itself returns nothing -- so this test allows a hex literal
  // only when it appears inside a resolveColorToken(...) call, not anywhere else in renderer JS.
  const rendererDir = path.join(root, "apps/desktop/renderer");
  const jsFiles = readdirSync(rendererDir).filter((name) => name.endsWith(".js"));
  const hexPattern = /#[0-9a-f]{3,8}\b/gi;
  for (const file of jsFiles) {
    const source = read(`apps/desktop/renderer/${file}`);
    for (const line of source.split("\n")) {
      if (!hexPattern.test(line)) continue;
      hexPattern.lastIndex = 0;
      assert.match(line, /resolveColorToken\(/, `${file}: literal color outside resolveColorToken(): ${line.trim()}`);
    }
  }
});
