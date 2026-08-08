"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "restricted-live-environment-preflight.ts");

function validateRestrictedLiveEnvironmentPreflight(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "EVIDENCE_ONLY_PREFLIGHT"',
    '"READY_FOR_HUMAN_REVIEW"',
    '"SAFE_BLOCK"',
    '"UNKNOWN"',
    'safetyCriticalUnknown: "fail_closed"',
    "networkDialAllowed: false",
    'executionTransportRequired: "DISCONNECTED"',
    "executionCredentialUse: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "automaticActivationAllowed: false",
    "realMoneyExecutionAllowed: false",
    '"EXECUTION_TRANSPORT_CONNECTED"',
    '"MUTATION_CAPABILITY_PRESENT"',
    '"TWO_DISTINCT_HUMANS_NOT_REQUIRED"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`PREFLIGHT_REQUIRED_MARKER_MISSING:${marker}`);
  const forbiddenMethods = /\b(submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|dialBroker|activateLive)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`PREFLIGHT_FORBIDDEN_METHOD:${match[1]}`);
  const forbiddenImports = /from\s+["'][^"']*(?:broker-client|execution-transport|execution-credential|live-adapter)[^"']*["']/i;
  if (forbiddenImports.test(source)) failures.push("PREFLIGHT_FORBIDDEN_EXECUTION_IMPORT");
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateRestrictedLiveEnvironmentPreflight();
  if (!result.ok) {
    console.error("Restricted LIVE environment preflight source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Restricted LIVE environment preflight source validation PASS");
}
module.exports = { validateRestrictedLiveEnvironmentPreflight };
