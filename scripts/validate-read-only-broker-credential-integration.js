const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = 'config/live/read-only-broker-credential-integration.json';
const CAPABILITY_POLICY = 'config/live/restricted-live-capability-surface-policy.json';
const SERVICE_SOURCE = 'apps/desktop/src/exchange/upbitReadOnlyService.ts';
const CREDENTIAL_SOURCE = 'apps/desktop/src/exchange/upbitReadOnlyCredentialProvider.ts';
const LAYOUT_SOURCE = 'apps/desktop/src/userDataLayout.ts';

function loadJson(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}
function loadText(root, file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validate(root = process.cwd()) {
  const failures = [];
  const config = loadJson(root, CONFIG);
  const capabilityPolicy = loadJson(root, CAPABILITY_POLICY);
  const serviceSource = loadText(root, SERVICE_SOURCE);
  const credentialSource = loadText(root, CREDENTIAL_SOURCE);
  const layoutSource = loadText(root, LAYOUT_SOURCE);

  if (config.version !== 1 || config.mode !== 'READ_ONLY_BROKER_CREDENTIAL_INTEGRATION') failures.push('CONFIG_INVALID');
  if (config.brokerTransportClass !== 'OBSERVATION_ONLY') failures.push('BROKER_TRANSPORT_NOT_OBSERVATION_ONLY');
  if (config.readOnlyBrokerTransportAllowed !== true) failures.push('READ_ONLY_TRANSPORT_NOT_ALLOWED');
  if (config.executionTransportConnected !== false) failures.push('EXECUTION_TRANSPORT_CONNECTED');
  if (config.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (config.realMoneyExecutionAllowed !== false) failures.push('REAL_MONEY_EXECUTION_ALLOWED');
  if (config.automaticLiveActivationAllowed !== false) failures.push('AUTOMATIC_LIVE_ACTIVATION_ALLOWED');

  const credentials = config.credentials || {};
  if (credentials.storage !== 'OS_ENCRYPTED') failures.push('CREDENTIAL_STORAGE_NOT_OS_ENCRYPTED');
  if (credentials.purpose !== 'READ_ONLY_BROKER_AUTH') failures.push('CREDENTIAL_PURPOSE_INVALID');
  if (credentials.readOnlyResolutionAllowed !== true) failures.push('READ_ONLY_CREDENTIAL_RESOLUTION_NOT_ALLOWED');
  if (credentials.executionUseAllowed !== false) failures.push('CREDENTIAL_EXECUTION_USE_ALLOWED');
  for (const field of ['rendererExposureAllowed', 'aiExposureAllowed', 'evidenceExposureAllowed', 'logExposureAllowed']) {
    if (credentials[field] !== false) failures.push(`SECRET_EXPOSURE_ALLOWED:${field}`);
  }

  const prohibited = new Set(config.prohibitedMutationMethods || []);
  for (const method of ['submitOrder', 'amendOrder', 'cancelOrder', 'withdraw', 'mutateCash', 'mutatePosition']) {
    if (!prohibited.has(method)) failures.push(`MUTATION_METHOD_NOT_PROHIBITED:${method}`);
  }
  if (config.reconciliation?.portfolioMutationAllowed !== false) failures.push('RECONCILIATION_PORTFOLIO_MUTATION_ALLOWED');
  if (config.ciNetworkPolicy?.realBrokerCallsAllowed !== false || config.ciNetworkPolicy?.mockTransportRequired !== true) failures.push('CI_NETWORK_POLICY_UNSAFE');

  if (!serviceSource.includes('type UpbitReadAdapter') || !serviceSource.includes('const adapter: UpbitReadAdapter')) failures.push('SERVICE_NOT_BOUND_TO_READ_ONLY_PORT');
  for (const method of ['submitOrder(', 'amendOrder(', 'cancelOrder(', 'withdraw(', 'mutateCash(', 'mutatePosition(']) {
    if (serviceSource.includes(method)) failures.push(`MUTATION_METHOD_EXPOSED_BY_SERVICE:${method.replace('(', '')}`);
  }
  if (!credentialSource.includes('safeStorage.encryptString') || !credentialSource.includes('safeStorage.decryptString')) failures.push('OS_ENCRYPTION_PORT_NOT_USED');
  for (const token of ['console.log', 'console.error', 'console.warn']) {
    if (credentialSource.includes(token)) failures.push(`CREDENTIAL_LOGGING_PRESENT:${token}`);
  }
  if (!layoutSource.includes('readOnlyBrokerCredentialFile')) failures.push('CREDENTIAL_LAYOUT_PATH_MISSING');

  const surfaceProhibited = new Set(capabilityPolicy.prohibitedPermissions || []);
  for (const permission of ['order:submit', 'order:cancel', 'broker:execute', 'credential:execution-use', 'cash:mutate', 'position:mutate']) {
    if (!surfaceProhibited.has(permission)) failures.push(`CAPABILITY_GUARD_MISSING:${permission}`);
  }

  return { pass: failures.length === 0, failures, config };
}

function buildEvidence(result, codeRevision = process.env.GITHUB_SHA || 'local') {
  return {
    version: 1,
    kind: 'read-only-broker-credential-integration',
    result: result.pass ? 'PASS' : 'FAIL',
    codeRevision,
    configurationHash: sha256(JSON.stringify(result.config)),
    observedAt: new Date().toISOString(),
    provider: result.config.provider,
    brokerTransportClass: result.config.brokerTransportClass,
    executionTransportConnected: result.config.executionTransportConnected,
    liveTradingMutation: result.config.liveTradingMutation,
    credentialStorage: result.config.credentials?.storage,
    credentialPurpose: result.config.credentials?.purpose,
    credentialExecutionUseAllowed: result.config.credentials?.executionUseAllowed,
    realMoneyExecutionAllowed: result.config.realMoneyExecutionAllowed,
    secretMaterialIncluded: false,
    failures: result.failures,
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
module.exports = { validate, buildEvidence, CONFIG, CAPABILITY_POLICY };
