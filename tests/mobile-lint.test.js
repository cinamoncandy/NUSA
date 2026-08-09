const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { collectMobileFiles, lintSource } = require("../scripts/lint-mobile.js");

const root = path.join(__dirname, "..");

test("mobile lint scans App and all TypeScript source extensions", () => {
  const files = collectMobileFiles(root).map((file) => path.relative(root, file).replaceAll("\\", "/"));
  assert.ok(files.includes("apps/mobile/App.tsx"));
  assert.ok(files.some((file) => file.endsWith(".ts")));
  assert.ok(files.some((file) => file.endsWith(".tsx")));
  assert.ok(files.every((file) => file === "apps/mobile/App.tsx" || file.startsWith("apps/mobile/src/")));
});

test("mobile lint accepts typed token-driven production code", () => {
  const source = `const message: unknown = "ok";\nexport const value = message;\n`;
  assert.deepEqual(lintSource("apps/mobile/src/example.ts", source), []);
});

test("mobile lint rejects explicit any, ts-ignore, debugger, console, and raw colors", () => {
  const source = `
// @ts-ignore temporary escape
const value: any = "#ff00aa";
console.log(value);
debugger;
`;
  const rules = lintSource("apps/mobile/src/example.ts", source).map((violation) => violation.rule);
  assert.ok(rules.includes("no-ts-ignore"));
  assert.ok(rules.includes("no-explicit-any"));
  assert.ok(rules.includes("design-token-color"));
  assert.ok(rules.includes("no-console"));
  assert.ok(rules.includes("no-debugger"));
});

test("mobile design-system token source may define raw hex colors", () => {
  const violations = lintSource("apps/mobile/src/designSystem.ts", `export const color = "#123456";\n`);
  assert.deepEqual(violations, []);
});
