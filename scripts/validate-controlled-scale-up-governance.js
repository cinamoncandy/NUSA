"use strict";
const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "controlled-scale-up-governance.ts");
function validateControlledScaleUpGovernance(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "VALIDATION_ONLY"',
    "actualHumanApprovalInCi: false",
    "exactProposalBinding: true",
    "requiredDistinctHumanApprovers: 2",
    "antiReplayRequired: true",
    "automaticScaleUpAllowed: false",
    "scaleUpAuthority: false",
    "activationAuthority: false",
    "orderAuthorization: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "credentialExecutionUse: false",
    "networkDialAllowed: false",
    "realMoneyExecutionAllowed: false",
    '"COMPLETE_FOR_SEPARATE_MANUAL_SCALE_CHANGE_REVIEW"',
    '"SCALE_POLICY_CHANGE_ID_ALREADY_USED"',
    '"PROPOSAL_NOT_MONOTONIC_EXPLICIT_SCALE_UP"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`SCALE_GOVERNANCE_REQUIRED_MARKER_MISSING:${marker}`);
  const forbidden = /\b(applyScale|changeLimit|setLimit|submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|activateLive|issueActivationToken)\s*\(/g;
  for (const match of source.matchAll(forbidden)) failures.push(`SCALE_GOVERNANCE_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}
if (require.main === module) {
  const result = validateControlledScaleUpGovernance();
  if (!result.ok) {
    console.error("Controlled scale-up governance source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Controlled scale-up governance source validation PASS");
}
module.exports = { validateControlledScaleUpGovernance };
