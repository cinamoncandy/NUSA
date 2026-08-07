const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validate(profile) {
  const failures = [];
  const adapter = profile.adapter || {};
  const credentials = profile.credentials || {};
  const authority = profile.authority || {};
  const safety = profile.safety || {};
  const rollback = profile.rollback || {};
  const counters = profile.mutationCounters || {};

  if (profile.mode !== 'RESTRICTED_LIVE_TRANSPORT_CREDENTIAL_READINESS') failures.push('MODE_INVALID');
  if (profile.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (profile.realMoneyExecutionAllowed !== false) failures.push('REAL_MONEY_EXECUTION_ALLOWED');
  if (profile.automaticActivationAllowed !== false) failures.push('AUTOMATIC_ACTIVATION_ALLOWED');
  if (profile.executionTransportConnected !== false) failures.push('EXECUTION_TRANSPORT_CONNECTED');
  if (profile.transportDialAllowed !== false) failures.push('TRANSPORT_DIAL_ALLOWED');

  if (adapter.registered !== true) failures.push('ADAPTER_NOT_REGISTERED');
  if (adapter.defaultState !== 'DISABLED') failures.push('ADAPTER_NOT_DISABLED');
  if (adapter.capability !== 'READ_ONLY_METADATA') failures.push('ADAPTER_CAPABILITY_NOT_READ_ONLY');
  if (adapter.executionMethodsExposed !== false) failures.push('EXECUTION_METHODS_EXPOSED');
  if (adapter.orderSubmissionExposed !== false) failures.push('ORDER_SUBMISSION_EXPOSED');
  if (adapter.cancelOrderExposed !== false) failures.push('CANCEL_ORDER_EXPOSED');

  if (credentials.schemaRegistered !== true) failures.push('CREDENTIAL_SCHEMA_NOT_REGISTERED');
  if (credentials.referenceMode !== 'METADATA_ONLY') failures.push('CREDENTIAL_REFERENCE_NOT_METADATA_ONLY');
  if (credentials.secretMaterialPresent !== false) failures.push('SECRET_MATERIAL_PRESENT');
  if (credentials.storageEnabled !== false) failures.push('CREDENTIAL_STORAGE_ENABLED');
  if (credentials.resolutionEnabled !== false) failures.push('CREDENTIAL_RESOLUTION_ENABLED');
  if (credentials.executionUseAllowed !== false) failures.push('CREDENTIAL_EXECUTION_USE_ALLOWED');
  if (credentials.evidenceRedactionRequired !== true) failures.push('EVIDENCE_REDACTION_NOT_REQUIRED');
  if (credentials.logSecretsAllowed !== false) failures.push('LOG_SECRETS_ALLOWED');
  if (credentials.secretFingerprintsIncluded !== false) failures.push('SECRET_FINGERPRINTS_INCLUDED');

  if (authority.principalKind !== 'SERVICE') failures.push('PRINCIPAL_KIND_INVALID');
  if (authority.capabilityScope !== 'READ_ONLY_METADATA') failures.push('CAPABILITY_SCOPE_INVALID');
  if (authority.liveAuthorityGranted !== false) failures.push('LIVE_AUTHORITY_GRANTED');
  if (authority.aiLiveAuthorityAllowed !== false) failures.push('AI_LIVE_AUTHORITY_ALLOWED');
  if (authority.metaAiLiveAuthorityAllowed !== false) failures.push('META_AI_LIVE_AUTHORITY_ALLOWED');
  if (authority.automationLiveAuthorityAllowed !== false) failures.push('AUTOMATION_LIVE_AUTHORITY_ALLOWED');

  if (safety.operationalStateRequired !== 'SAFE') failures.push('SAFE_NOT_REQUIRED');
  if (safety.safetyCriticalUnknownAllowed !== false) failures.push('UNKNOWN_NOT_FAIL_CLOSED');
  if (safety.killSwitchMustBeInactive !== true) failures.push('KILL_SWITCH_INACTIVE_NOT_REQUIRED');
  if (safety.hardRiskResultRequired !== 'PASS') failures.push('HARD_RISK_PASS_NOT_REQUIRED');

  if (rollback.required !== true) failures.push('ROLLBACK_NOT_REQUIRED');
  if (rollback.disconnectOnFailure !== true) failures.push('DISCONNECT_ON_FAILURE_NOT_REQUIRED');
  if (rollback.credentialResolutionMustRemainDisabled !== true) failures.push('CREDENTIAL_RESOLUTION_ROLLBACK_NOT_REQUIRED');

  for (const key of ['transportDials','credentialResolutions','brokerCalls','orders','fills','cash','positions']) {
    if (counters[key] !== 0) failures.push(`MUTATION_COUNTER_NONZERO:${key}`);
  }

  return { pass: failures.length === 0, failures };
}

function buildEvidence(profile, codeRevision = process.env.GITHUB_SHA || 'local') {
  const result = validate(profile);
  return {
    version: 1,
    kind: 'restricted-live-transport-credential-readiness',
    result: result.pass ? 'PASS' : 'FAIL',
    observedAt: new Date().toISOString(),
    codeRevision,
    configurationHash: sha256(JSON.stringify(profile)),
    executionTransportConnected: profile.executionTransportConnected,
    transportDialAllowed: profile.transportDialAllowed,
    adapterState: profile.adapter?.defaultState,
    adapterCapability: profile.adapter?.capability,
    credentialReferenceMode: profile.credentials?.referenceMode,
    secretMaterialPresent: profile.credentials?.secretMaterialPresent,
    credentialResolutionEnabled: profile.credentials?.resolutionEnabled,
    credentialExecutionUseAllowed: profile.credentials?.executionUseAllowed,
    evidenceRedactionRequired: profile.credentials?.evidenceRedactionRequired,
    principalKind: profile.authority?.principalKind,
    capabilityScope: profile.authority?.capabilityScope,
    liveAuthorityGranted: profile.authority?.liveAuthorityGranted,
    rollbackRequired: profile.rollback?.required,
    realMoneyExecutionAllowed: profile.realMoneyExecutionAllowed,
    mutationCounters: profile.mutationCounters,
    checks: result.failures.length ? result.failures : ['ALL_TRANSPORT_CREDENTIAL_READINESS_CHECKS_PASS']
  };
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
  const positional = args.filter((arg, index) => arg !== '--output' && (index === 0 || args[index - 1] !== '--output'));
  const profilePath = path.resolve(positional[0] || 'config/live/restricted-live-transport-credential-readiness.json');
  const profile = loadJson(profilePath);
  const evidence = buildEvidence(profile);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.result !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { validate, buildEvidence };
