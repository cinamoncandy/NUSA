const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE = 'apps/desktop/src/cloud/readOnlyOperatorProjection.ts';
const WORK_ORDER = '.aipos/work-orders/WO-0037-read-only-operator-projection.yaml';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validate(root = process.cwd()) {
  const failures = [];
  const source = fs.readFileSync(path.join(root, SOURCE), 'utf8');
  const wo = fs.readFileSync(path.join(root, WORK_ORDER), 'utf8');
  if (!source.includes('mode: "READ_ONLY"')) failures.push('READ_ONLY_MODE_MISSING');
  if (!source.includes('execution: false')) failures.push('EXECUTION_AUTHORITY_NOT_FALSE');
  if (!source.includes('orderMutation: false')) failures.push('ORDER_MUTATION_AUTHORITY_NOT_FALSE');
  if (!source.includes('withdrawals: false')) failures.push('WITHDRAWAL_AUTHORITY_NOT_FALSE');
  if (!source.includes('credentialMaterial: false')) failures.push('CREDENTIAL_MATERIAL_AUTHORITY_NOT_FALSE');
  if (/submitOrder\s*\(|cancelOrder\s*\(|withdraw\s*\(/.test(source)) failures.push('MUTATION_METHOD_EXPOSED');
  if (!/live_trading_mutation: prohibited/.test(wo) || !/real_money_execution: prohibited/.test(wo)) failures.push('WO_SAFETY_BOUNDARY_INVALID');
  return { pass: failures.length === 0, failures, sourceHash: sha256(source), workOrderHash: sha256(wo) };
}
function buildEvidence(result, codeRevision = process.env.GITHUB_SHA || 'local') {
  return { version: 1, kind: 'read-only-operator-projection', result: result.pass ? 'PASS' : 'FAIL', codeRevision, configurationHash: sha256(JSON.stringify({ sourceHash: result.sourceHash, workOrderHash: result.workOrderHash })), observedAt: new Date().toISOString(), executionAuthority: false, orderMutationAuthority: false, withdrawalAuthority: false, credentialMaterialIncluded: false, failures: result.failures };
}
function main() {
  const args = process.argv.slice(2).filter((x) => x !== '--');
  const i = args.indexOf('--output'); const output = i >= 0 ? args[i + 1] : null;
  const result = validate(); const evidence = buildEvidence(result);
  if (output) { const target = path.resolve(output); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`); }
  console.log(JSON.stringify(evidence, null, 2));
  if (!result.pass) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { validate, buildEvidence };
