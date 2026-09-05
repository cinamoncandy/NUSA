import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const runtimePath = path.resolve(__dirname, "closedLearningProductionRuntime.ts");

describe("closed-learning production rollover composition", () => {
  it("connects only the canonical rollover/evidence components and stops the timer with the runtime", () => {
    const source = fs.readFileSync(runtimePath, "utf8");
    assert.match(source, /new ClosedLearningRolloverScheduler/);
    assert.match(source, /new ClosedLearningEvidenceIdentitySource/);
    assert.match(source, /CLOUD_PAPER_RISK_POLICY_FINGERPRINT/);
    assert.match(source, /baseHandle\.closePaperRealizedPeriodFromCanonicalAccount/);
    assert.match(source, /baseHandle\.openPaperRealizedPeriodFromCanonicalAccount/);
    assert.match(source, /coordinator\.run\(identity\)/);
    assert.match(source, /clearInterval\(rolloverTimer\)/);
    assert.doesNotMatch(source, /LIVE_ORDER|private broker|withdraw|transfer/i);
  });
});
