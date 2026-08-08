"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "production-release-artifact-seal.ts");

function validateProductionReleaseArtifactSeal(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "EVIDENCE_ONLY_SEAL"',
    "exactCodeBinding: true",
    "exactConfigurationBinding: true",
    "exactArtifactHashBinding: true",
    "rollbackBinding: true",
    "signedVerifiedRequiredForProductionReview: true",
    "deploymentAuthority: false",
    "activationAuthority: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "networkDialAllowed: false",
    "credentialExecutionUse: false",
    "realMoneyExecutionAllowed: false",
    '"READY_FOR_PRODUCTION_HUMAN_REVIEW"',
    '"RELEASE_UNSIGNED"',
    '"ROLLBACK_BUNDLE_MISMATCH"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`RELEASE_SEAL_REQUIRED_MARKER_MISSING:${marker}`);
  const forbiddenMethods = /\b(deploy|activateLive|submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|dialBroker|issueActivationToken)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`RELEASE_SEAL_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateProductionReleaseArtifactSeal();
  if (!result.ok) {
    console.error("Production release artifact seal source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Production release artifact seal source validation PASS");
}
module.exports = { validateProductionReleaseArtifactSeal };
