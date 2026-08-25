"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "desktop", "src", "exchange", "externalReadOnlyEnvironmentPreflight.ts");

function validateExternalReadOnlyEnvironmentPreflight(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "OPERATOR_GATED_READ_ONLY"',
    "actualExternalProbeInCi: false",
    "explicitOperatorAuthorizationRequired: true",
    "activationAuthority: false",
    "orderAuthorization: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "credentialExecutionUse: false",
    "realMoneyExecutionAllowed: false",
    '"NOT_RUN"',
    '"READY_FOR_HUMAN_REVIEW"',
    '"SAFE_BLOCK"',
    '"UNKNOWN"',
    "operatorAuthorizedExternalProbe",
    "port.captureSnapshot(request.timeoutMs)"
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`EXTERNAL_READONLY_PREFLIGHT_REQUIRED_MARKER_MISSING:${marker}`);

  const forbidden = /\b(saveForReadOnlyUse|loadForReadOnlyUse|deleteCredentials|submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|activateLive|issueActivationToken)\s*\(/g;
  for (const match of source.matchAll(forbidden)) failures.push(`EXTERNAL_READONLY_PREFLIGHT_FORBIDDEN_METHOD:${match[1]}`);
  if (/process\.env|UPBIT_ACCESS_KEY|UPBIT_SECRET_KEY|Bearer\s/i.test(source)) failures.push("EXTERNAL_READONLY_PREFLIGHT_SECRET_OR_ENV_ACCESS_FORBIDDEN");

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateExternalReadOnlyEnvironmentPreflight();
  if (!result.ok) {
    console.error("External read-only environment preflight source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("External read-only environment preflight source validation PASS");
}

module.exports = { validateExternalReadOnlyEnvironmentPreflight };
