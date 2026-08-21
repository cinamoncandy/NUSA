// The apps/cloud/src paper trading engine port (3-2) is a set of files intentionally kept
// byte-identical to their apps/desktop/src originals, aside from the import-path rewrites
// documented in this file's fixture list -- see the "feat: port the paper trading engine +
// safety gates to apps/cloud/src (3-2)" PR for why. Nothing enforced that identity after the
// port landed: a future desktop-only safety fix (the exact pattern this whole safety-gate
// hardening effort has been about) could be applied to one copy and never reach the other,
// leaving the cloud engine silently running an unpatched gate while every desktop test still
// passes. This file is that enforcement.
//
// Each entry's `rewrites` lists every substring replacement needed to turn the desktop source
// into the cloud source. If a real edit lands on one side and not the other, either the rewrite
// map stops explaining the full diff (this test fails with a diff-style message) or, for the
// files with an empty rewrite list, the files stop being identical outright.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");

// apps/desktop/src was reorganized into domain subfolders; this map records where each
// tracked file lives now so this test keeps finding the desktop original.
const DESKTOP_BUCKET = {
  "paperBroker.ts": "paper",
  "strategyEngine.ts": "strategy",
  "regimePolicy.ts": "strategy",
  "upbitWebSocket.ts": "exchange",
  "marketConnectionSupervisor.ts": "exchange",
  "controlPlane.ts": "control",
  "runtimeMutationDiagnostics.ts": "risk",
  "runtimeExchangeCapabilities.ts": "exchange",
  "paperSafetyGates.ts": "paper",
  "paperRiskState.ts": "paper",
  "independentRiskGateway.ts": "risk",
  "paperApprovalService.ts": "paper",
  "paperScenarioEvidenceRecorder.ts": "paper",
  "runtimeCommandService.ts": "control",
  "paperOperationalPreflight.ts": "paper"
};
const desktopPath = (name) => join(ROOT, "apps", "desktop", "src", DESKTOP_BUCKET[name] ?? "", name);
const cloudPath = (name) => join(ROOT, "apps", "cloud", "src", name);

// Files ported with no changes at all beyond being in a new directory.
const IDENTICAL_FILES = [
  "paperBroker.ts",
  "strategyEngine.ts",
  "regimePolicy.ts",
  "upbitWebSocket.ts",
  "marketConnectionSupervisor.ts",
  "controlPlane.ts",
  "runtimeMutationDiagnostics.ts",
  "runtimeExchangeCapabilities.ts",
  "paperSafetyGates.ts",
  "paperRiskState.ts",
  "independentRiskGateway.ts",
  "paperApprovalService.ts"
];

// Files ported with import-path rewrites only, because their desktop originals reached across
// the apps/desktop -> apps/cloud boundary for a dependency that now sits next to them instead.
// Each rewrite is applied to the desktop source in order; the result must equal the cloud source
// exactly, so any OTHER divergence (a real logic edit on one side, not just a path) still fails.
const REWRITTEN_FILES = [
  {
    name: "paperScenarioEvidenceRecorder.ts",
    rewrites: [
      ['import type { PaperScenarioEvent, PaperScenarioRecord } from "../../cloud/src/paperScenarioEvidenceLedger";',
        'import type { PaperScenarioEvent, PaperScenarioRecord } from "./paperScenarioEvidenceLedger";']
    ]
  },
  {
    name: "runtimeCommandService.ts",
    rewrites: [
      ['import type { OperationalReadinessDecision } from "../../cloud/src/operationalReadinessGate";',
        'import type { OperationalReadinessDecision } from "./operationalReadinessGate";']
    ]
  },
  {
    name: "paperOperationalPreflight.ts",
    rewrites: []
  }
];

function applyRewrites(source, rewrites) {
  let result = source;
  for (const [from, to] of rewrites) {
    assert.ok(result.includes(from), `expected desktop source to contain the text this rewrite targets: ${JSON.stringify(from)}`);
    result = result.replace(from, to);
  }
  return result;
}

// apps/desktop/src files that live inside a domain bucket sit one directory deeper than
// apps/cloud/src's flat layout, so a relative import that reaches outside apps/desktop/src
// needs one extra "../" on the desktop side purely from that depth difference. Undo that
// before comparing, so this test still catches a real content divergence rather than the
// folder-depth artifact.
function normalizeBucketDepth(source, name) {
  if (!DESKTOP_BUCKET[name]) return source;
  let result = source;
  // A sibling that used to be a flat "./X" import may now be a cross-bucket "../bucket/X"
  // import if X moved to a different bucket than this file. Undo that first, before the
  // generic depth strip below eats the leading "../".
  for (const [otherFile, otherBucket] of Object.entries(DESKTOP_BUCKET)) {
    const otherName = otherFile.replace(/\.ts$/, "");
    if (otherBucket === DESKTOP_BUCKET[name]) continue;
    result = result.replace(new RegExp(`from "\\.\\./${otherBucket}/${otherName}"`, "g"), `from "./${otherName}"`);
  }
  // Any import that still reaches outside apps/desktop/src has one extra "../" purely from
  // this file's bucket depth.
  result = result.replace(/from\s+"(\.\.\/)+/g, (m) => m.replace("../", ""));
  return result;
}

for (const name of IDENTICAL_FILES) {
  test(`apps/cloud/src/${name} is byte-identical to the desktop original it was ported from`, () => {
    const desktop = normalizeBucketDepth(readFileSync(desktopPath(name), "utf8"), name);
    const cloud = readFileSync(cloudPath(name), "utf8");
    assert.equal(cloud, desktop, `apps/cloud/src/${name} has drifted from apps/desktop/src/${name}. If this is an intentional cloud-only change, either port it to desktop too (most safety fixes belong on both) or move this file from IDENTICAL_FILES to REWRITTEN_FILES in this test with the exact diff recorded as a rewrite.`);
  });
}

for (const { name, rewrites } of REWRITTEN_FILES) {
  test(`apps/cloud/src/${name} matches the desktop original after its known import-path rewrites`, () => {
    const desktop = normalizeBucketDepth(readFileSync(desktopPath(name), "utf8"), name);
    const cloud = readFileSync(cloudPath(name), "utf8");
    const expected = applyRewrites(desktop, rewrites);
    assert.equal(cloud, expected, `apps/cloud/src/${name} differs from apps/desktop/src/${name} by more than its recorded import-path rewrites -- a real logic change landed on one side without the other. If intentional, update the rewrite list above to reflect it explicitly.`);
  });
}

test("every ported file this test tracks still exists on both sides", () => {
  for (const name of [...IDENTICAL_FILES, ...REWRITTEN_FILES.map((f) => f.name)]) {
    assert.doesNotThrow(() => readFileSync(desktopPath(name)), `apps/desktop/src/${name} is missing`);
    assert.doesNotThrow(() => readFileSync(cloudPath(name)), `apps/cloud/src/${name} is missing`);
  }
});
