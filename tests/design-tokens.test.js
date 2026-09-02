const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
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

test("desktop loads semantic tokens before shared components and product styles", () => {
  const html = read("apps/desktop/renderer/index.html");
  const tokenIndex = html.indexOf('href="tokens.css"');
  const componentIndex = html.indexOf('href="components.css"');
  const appIndex = html.indexOf('href="app.css"');
  assert.ok(tokenIndex >= 0);
  assert.ok(componentIndex > tokenIndex);
  assert.ok(appIndex > componentIndex);
  assert.doesNotMatch(html, /href="styles\.css"/);
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

test("historical renderer styles use semantic variables rather than literal colors", () => {
  const styles = read("apps/desktop/renderer/styles.css");
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /\brgba?\(/i);
  assert.match(styles, /var\(--color-bg\)/);
  assert.match(styles, /var\(--color-primary\)/);
});
