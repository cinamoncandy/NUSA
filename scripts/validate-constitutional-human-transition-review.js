"use strict";
const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "constitutional-human-transition-review.ts");

function validateConstitutionalHumanTransitionReview(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "EVIDENCE_AGGREGATION_ONLY"',
    "syntheticEvidenceCannotSatisfyRealWorldGate: true",
    "actualExternalBrokerValidationInCi: false",
    "actualHumanCeremonyInCi: false",
    "actualTinyLiveSessionInCi: false",
    "automaticProductionTransitionAllowed: false",
    "constitutionalDecisionAuthority: false",
    "deploymentAuthority: false",
    "activationAuthority: false",
    "scaleUpAuthority: false",
    "orderAuthorization: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "credentialExecutionUse: false",
    "networkDialAllowed: false",
    "realMoneyExecutionAllowed: false",
    '"READY_FOR_CONSTITUTIONAL_HUMAN_REVIEW"',
    '"INCOMPLETE"',
    '"SAFE_BLOCK"',
    '"UNKNOWN"',
    '"SIGNED_PRODUCTION_ARTIFACT"',
    '"EXTERNAL_READONLY_PREFLIGHT"',
    '"HUMAN_ACTIVATION_CEREMONY"',
    '"TINY_BOUNDED_LIVE_SESSION"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`CONSTITUTIONAL_REVIEW_REQUIRED_MARKER_MISSING:${marker}`);
  const forbidden = /\b(deploy|promoteProduction|applyScale|changeLimit|setLimit|submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|dialBroker|activateLive|issueActivationToken|issueAuthorizationToken)\s*\(/g;
  for (const match of source.matchAll(forbidden)) failures.push(`CONSTITUTIONAL_REVIEW_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateConstitutionalHumanTransitionReview();
  if (!result.ok) {
    console.error("Constitutional human transition review source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Constitutional human transition review source validation PASS");
}
module.exports = { validateConstitutionalHumanTransitionReview };
