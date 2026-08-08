"use strict";
const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "post-live-session-validation.ts");
function validatePostLiveSessionValidation(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "EVIDENCE_VALIDATION_ONLY"',
    "actualLiveSessionInCi: false",
    "scaleUpAuthority: false",
    "activationAuthority: false",
    "orderAuthorization: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "realMoneyExecutionAllowed: false",
    '"READY_FOR_HUMAN_REVIEW"',
    '"SAFE_BLOCK"',
    '"UNKNOWN"',
    '"EXECUTION_TRANSPORT_STILL_OPEN"',
    '"MUTATION_AFTER_SESSION_CLOSE"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`POST_LIVE_VALIDATION_REQUIRED_MARKER_MISSING:${marker}`);
  const forbidden = /\b(submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|activateLive|issueActivationToken|scaleUp)\s*\(/g;
  for (const match of source.matchAll(forbidden)) failures.push(`POST_LIVE_VALIDATION_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}
if (require.main === module) {
  const result = validatePostLiveSessionValidation();
  if (!result.ok) {
    console.error("Post-LIVE session validation source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Post-LIVE session validation source validation PASS");
}
module.exports = { validatePostLiveSessionValidation };
