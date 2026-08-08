"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "restricted-live-activation-ceremony.ts");

function validateRestrictedLiveActivationCeremony(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "VALIDATION_ONLY"',
    "actualCeremonyConductedByCi: false",
    "activationCredentialIssued: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "actualActivationPerformed: false",
    "automaticActivationAllowed: false",
    "executionCredentialUse: false",
    "networkDialAllowed: false",
    "realMoneyExecutionAllowed: false",
    "requiredDistinctHumanApprovers: 2",
    "antiReplayRequired: true",
    "externalSignatureVerificationRequired: true",
    '"COMPLETE_FOR_SEPARATE_MANUAL_ACTIVATION_REVIEW"',
    '"CEREMONY_ID_ALREADY_USED"',
    '"REQUESTER_APPROVER_NOT_SEPARATED"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`CEREMONY_REQUIRED_MARKER_MISSING:${marker}`);
  const forbiddenMethods = /\b(submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|dialBroker|activateLive|issueActivationToken)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`CEREMONY_FORBIDDEN_METHOD:${match[1]}`);
  const forbiddenImports = /from\s+["'][^"']*(?:broker-client|execution-transport|execution-credential|live-adapter)[^"']*["']/i;
  if (forbiddenImports.test(source)) failures.push("CEREMONY_FORBIDDEN_EXECUTION_IMPORT");
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateRestrictedLiveActivationCeremony();
  if (!result.ok) {
    console.error("Restricted LIVE activation ceremony source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Restricted LIVE activation ceremony source validation PASS");
}
module.exports = { validateRestrictedLiveActivationCeremony };
