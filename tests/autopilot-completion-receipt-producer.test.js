"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { workerRuntimeChanged } = require("../scripts/autopilot-worker-deploy-scope.js");
const { changesWorkerRuntime } = require("../dist/apps/autopilot/src/completionReceiptProducer.js");

test("the receipt producer's Worker runtime scope matches the deploy scope script exactly", () => {
  const samples = [
    ["apps/autopilot/src/a.ts"], ["apps/autopilot/wrangler.jsonc"], ["apps/cloud/src/ai/x.ts"], ["apps/cloud/src/y.ts"],
    ["packages/contracts/src/z.ts"], ["package.json"], ["pnpm-lock.yaml"], ["pnpm-workspace.yaml"], ["tsconfig.json"], ["tsconfig.base.json"],
    ["docs/x.md"], ["apps/desktop/src/z.ts"], ["apps/autopilotx/a.ts"], ["scripts/a.js"], [".github/workflows/ci.yml"], ["README.md"],
    ["docs/x.md", "apps/cloud/src/a.ts"], [],
  ];
  for (const files of samples) {
    assert.equal(changesWorkerRuntime(files), workerRuntimeChanged(files), JSON.stringify(files));
  }
});
