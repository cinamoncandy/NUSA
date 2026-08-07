const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGISTRY = 'config/capabilities/registry.json';
const POLICY = 'config/live/restricted-live-capability-surface-policy.json';
const READINESS = 'config/live/restricted-live-transport-credential-readiness.json';

function load(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validate(root = process.cwd()) {
  const failures = [];
  const registry = load(root, REGISTRY);
  const policy = load(root, POLICY);
  const readiness = load(root, READINESS);
  const prohibited = new Set(policy.prohibitedPermissions || []);
  if (policy.version !== 1 || policy.mode !== 'RESTRICTED_LIVE_CAPABILITY_SURFACE_GUARD') failures.push('POLICY_INVALID');
  if (policy.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  for (const contract of registry.contracts || []) {
    if (!Array.isArray(contract.permissions)) {
      failures.push(`PERMISSIONS_INVALID:${contract.capabilityId || 'UNKNOWN'}`);
      continue;
    }
    for (const permission of contract.permissions) {
      if (typeof permission !== 'string' || !permission.trim()) failures.push(`PERMISSION_INVALID:${contract.capabilityId || 'UNKNOWN'}`);
      else if (prohibited.has(permission)) failures.push(`PROHIBITED_LIVE_PERMISSION:${contract.capabilityId}:${permission}`);
    }
  }
  const required = policy.requiredReadiness || {};
  if (readiness.adapter?.defaultState !== required.adapterDefaultState) failures.push('ADAPTER_NOT_DISABLED');
  if (readiness.adapter?.executionMethodsExposed !== required.executionMethodsExposed) failures.push('EXECUTION_METHOD_SURFACE_MISMATCH');
  if (readiness.transportDialAllowed !== required.transportDialAllowed) failures.push('TRANSPORT_DIAL_SURFACE_MISMATCH');
  if (readiness.credentials?.resolutionEnabled !== required.credentialResolutionEnabled) failures.push('CREDENTIAL_RESOLUTION_SURFACE_MISMATCH');
  if (readiness.credentials?.executionUseAllowed !== required.credentialExecutionUseAllowed) failures.push('CREDENTIAL_EXECUTION_SURFACE_MISMATCH');
  if (readiness.realMoneyExecutionAllowed !== required.realMoneyExecutionAllowed) failures.push('REAL_MONEY_SURFACE_MISMATCH');
  if (readiness.executionTransportConnected !== required.executionTransportConnected) failures.push('EXECUTION_TRANSPORT_SURFACE_MISMATCH');
  for (const counter of policy.requiredZeroCounters || []) {
    if (readiness.mutationCounters?.[counter] !== 0) failures.push(`MUTATION_COUNTER_NONZERO:${counter}`);
  }
  return { pass: failures.length === 0, failures, registry, policy, readiness };
}
function buildEvidence(result, codeRevision = process.env.GITHUB_SHA || 'local') {
  return {
    version: 1,
    kind: 'restricted-live-capability-surface-guard',
    result: result.pass ? 'PASS' : 'FAIL',
    codeRevision,
    configurationHash: sha256(JSON.stringify({ policy: result.policy, readiness: result.readiness })),
    observedAt: new Date().toISOString(),
    prohibitedPermissionCount: (result.policy.prohibitedPermissions || []).length,
    capabilityContractCount: (result.registry.contracts || []).length,
    failures: result.failures,
    executionTransportConnected: result.readiness.executionTransportConnected,
    credentialResolutionEnabled: result.readiness.credentials?.resolutionEnabled,
    realMoneyExecutionAllowed: result.readiness.realMoneyExecutionAllowed,
    mutationCounters: result.readiness.mutationCounters
  };
}
function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const result = validate();
  const evidence = buildEvidence(result);
  if (output) {
    const resolved = path.resolve(output);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (!result.pass) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { validate, buildEvidence, REGISTRY, POLICY, READINESS };
