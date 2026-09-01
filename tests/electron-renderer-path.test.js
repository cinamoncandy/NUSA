const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveRendererIndexPath } = require("../dist/apps/desktop/src/rendererPath.js");

test("renderer index path resolves from the compiled Electron main directory", () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const compiledMainDirectory = path.join(repositoryRoot, "dist", "apps", "desktop", "src");

  const resolved = resolveRendererIndexPath(compiledMainDirectory);
  const expected = path.join(repositoryRoot, "apps", "desktop", "renderer", "index-v2.html");

  assert.equal(resolved, expected);
});

test("renderer index path does not duplicate apps/desktop", () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const compiledMainDirectory = path.join(repositoryRoot, "dist", "apps", "desktop", "src");

  const resolved = resolveRendererIndexPath(compiledMainDirectory);
  const normalized = resolved.replaceAll("\\", "/");

  assert.doesNotMatch(normalized, /apps\/desktop\/apps\/desktop/);
});
