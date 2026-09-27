"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * WO-20260924-PAPER-CHALLENGER-POLICY-APPROVAL / ADR-0018.
 *
 * PaperChallengerDeploymentRuntime refuses to deploy without a Strategy Governance port, and the
 * production composition root constructed it without one, so a qualified candidate could never
 * reach PAPER and its first appearance would have stopped the runtime. Unit tests all passed
 * because they supply their own port. This guards the production wiring itself.
 */
const source = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/closedLearningProductionRuntime.ts"), "utf8");

test("the production closed-learning composition passes a Governance port to PAPER deployment", () => {
  const start = source.indexOf("new PaperChallengerDeploymentRuntime(");
  assert.ok(start > 0, "expected the production composition to construct PaperChallengerDeploymentRuntime");
  const call = source.slice(start, source.indexOf("});", start));
  assert.match(call, /governance:\s*new PaperChallengerPolicyApproval\(/, "the deployment runtime must receive the ADR-0018 Governance approval port");
  assert.match(call, /enabled:\s*paperChallengerPolicyEnabled\(env\)/, "policy approval must stay behind the explicit operator switch");
});
