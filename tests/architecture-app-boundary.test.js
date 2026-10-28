const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeRepository, boundaryApp } = require("../scripts/validate-architecture.js");

function repo(files, baseline) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-boundary-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  if (baseline) {
    fs.mkdirSync(path.join(root, ".aipos"), { recursive: true });
    fs.writeFileSync(path.join(root, ".aipos", "architecture-boundary-baseline.json"), JSON.stringify({ references: baseline }));
  }
  return root;
}
const rules = (root) => analyzeRepository(root).findings.map((item) => `${item.rule} ${item.source} -> ${item.target}`);

test("a new import between apps or from a package into an app is a finding", () => {
  const root = repo({
    "apps/cloud/src/a.ts": 'import { b } from "../../desktop/src/b";\nexport const a = b;\n',
    "apps/desktop/src/b.ts": "export const b = 1;\n",
    "packages/core/src/c.ts": 'import { d } from "../../../apps/mobile/src/d";\nexport const c = d;\n',
    "apps/mobile/src/d.ts": "export const d = 1;\n",
  });
  assert.deepEqual(rules(root).filter((line) => /CROSS_APP|PACKAGE_TO_APP/.test(line)).sort(), [
    "CROSS_APP_REFERENCE apps/cloud/src/a.ts -> apps/desktop/src/b.ts",
    "PACKAGE_TO_APP_REFERENCE packages/core/src/c.ts -> apps/mobile/src/d.ts",
  ]);
});

test("a baselined reference passes, and a baseline entry that no longer exists fails", () => {
  const files = { "apps/cloud/src/a.ts": 'import { b } from "../../desktop/src/b";\nexport const a = b;\n', "apps/desktop/src/b.ts": "export const b = 1;\n" };
  assert.deepEqual(rules(repo(files, ["apps/cloud/src/a.ts -> apps/desktop/src/b.ts"])).filter((line) => /CROSS_APP|BASELINE/.test(line)), []);
  const stale = rules(repo({ "apps/cloud/src/a.ts": "export const a = 1;\n" }, ["apps/cloud/src/a.ts -> apps/desktop/src/b.ts"]));
  assert.ok(stale.some((line) => line.startsWith("BOUNDARY_BASELINE_STALE apps/cloud/src/a.ts -> apps/desktop/src/b.ts")));
});

test("apps/execution is a shared domain, and imports inside one app are fine", () => {
  assert.equal(boundaryApp("apps/execution/src/order.ts"), null);
  assert.equal(boundaryApp("apps/cloud/src/runtime.ts"), "cloud");
  const root = repo({ "apps/cloud/src/a.ts": 'import { b } from "./b";\nexport const a = b;\n', "apps/cloud/src/b.ts": "export const b = 1;\n" });
  assert.deepEqual(rules(root).filter((line) => /CROSS_APP|PACKAGE_TO_APP/.test(line)), []);
});

test("the repository baseline only shrinks: it is sorted, unique and every entry still exists", () => {
  const baseline = JSON.parse(fs.readFileSync(".aipos/architecture-boundary-baseline.json", "utf8")).references;
  assert.deepEqual(baseline, [...new Set(baseline)].sort());
  assert.deepEqual(analyzeRepository().findings.filter((item) => /BOUNDARY_BASELINE_STALE|CROSS_APP|PACKAGE_TO_APP/.test(item.rule)), []);
});
