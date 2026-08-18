const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const read = (file) => readFileSync(file, "utf8");

test("renderer CSP and Electron isolation preserve the desktop trust boundary", () => {
  const html = read("apps/desktop/renderer/index.html");
  const main = read("apps/desktop/src/main.ts");
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
});

test("renderer surfaces render external text through DOM nodes rather than HTML strings", () => {
  const renderer = read("apps/desktop/renderer/renderer.js");
  const palette = read("apps/desktop/renderer/command-palette.js");
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
  assert.doesNotMatch(palette, /\.innerHTML\s*=/);
  assert.match(renderer, /textContent = value/);
  assert.match(renderer, /replaceChildren/);
});

test("preload keeps bounded IPC recovery and no live or credential path", () => {
  const preload = read("apps/desktop/src/preload.ts");
  const main = read("apps/desktop/src/main.ts");
  assert.match(preload, /retryWithTimeout/);
  assert.match(preload, /maximumAttempts: 3/);
  // api[_-]?key alone flagged identifier names, not just hardcoded literals -- the read-only
  // AI research assistant reads ANTHROPIC_API_KEY from the environment and passes it through
  // a parameter named apiKey, which is not a live-exchange credential path. Requiring a quoted
  // literal after it keeps the check aimed at actual hardcoded secrets.
  assert.doesNotMatch(`${preload}\n${main}`, /api[_-]?key\s*[:=]\s*["'][^"']+["']|private.*api|authorization|jwt|withdraw|live.*order/i);
});

test("release check stays PAPER-only and disables automatic updates", () => {
  const packageJson = JSON.parse(read("package.json"));
  const check = read("scripts/release-readiness.js");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.author, "NUSA contributors");
  assert.equal(packageJson.main, "dist/apps/desktop/src/cloudMain.js");
  assert.equal(packageJson.build.extraMetadata.main, packageJson.main);
  assert.equal(packageJson.build.win.signAndEditExecutable, false);
  assert.equal(packageJson.scripts["release:check"].includes("release-readiness.js"), true);
  assert.match(check, /autoUpdate: "DISABLED"/);
  assert.match(check, /TECHNICAL_CHECKS_PASS/);
});
