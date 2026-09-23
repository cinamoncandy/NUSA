"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { validateAiposYaml } = require("../scripts/validate-aipos-yaml.js");

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "aipos-yaml-"));
  mkdirSync(join(root, ".aipos", "work-orders"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body, "utf8");
  return { root, names: Object.keys(files) };
}

test("every tracked AIPOS YAML file in this repository parses strictly", () => {
  const { checked, failures } = validateAiposYaml();
  assert.ok(checked > 100, `expected the full AIPOS tree, checked ${checked}`);
  assert.deepEqual(failures, []);
});

for (const [label, body] of [
  ["a duplicate mapping key", "block:\n  safety:\n    ai_authority: ZERO_AUTHORITY\n  safety: PAPER_ONLY\n"],
  ["a list item opening with a backtick", "acceptance:\n  - `pnpm validate` exists\n"],
  ["an unquoted colon-space inside a scalar", "remediation: Retry the probe; note: bounded\n"],
]) {
  test(`rejects ${label}`, () => {
    const { root, names } = fixture({ ".aipos/work-orders/WO-X.yaml": body });
    try {
      const { failures } = validateAiposYaml(root, names);
      assert.equal(failures.length, 1);
      assert.equal(failures[0].file, ".aipos/work-orders/WO-X.yaml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("accepts the quoted forms used to repair those files", () => {
  const { root, names } = fixture({
    ".aipos/work-orders/WO-Y.yaml": 'acceptance:\n  - "`pnpm validate` exists"\nremediation: "Retry the probe; note: bounded"\nblock:\n  safety_boundary: PAPER_ONLY\n',
  });
  try {
    assert.deepEqual(validateAiposYaml(root, names).failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
