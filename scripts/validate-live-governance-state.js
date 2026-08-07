const { readFileSync } = require('node:fs');
const path = 'apps/execution/src/live-governance-state.ts';
const source = readFileSync(path, 'utf8');
const failures = [];
for (const token of ['DISABLED','ARMED','AUTHORIZED','ACTIVE','COOLDOWN','HALT','LIVE_ACTIVE_PROHIBITED_FAIL_CLOSED','LIVE_STATE_UNKNOWN_FAIL_CLOSED']) if (!source.includes(token)) failures.push(`MISSING:${token}`);
for (const forbidden of ['submitOrder(', 'cancelOrder(', 'withdraw(', 'resolveCredential(']) if (source.includes(forbidden)) failures.push(`FORBIDDEN_SURFACE:${forbidden}`);
if (!source.includes('realMoneyExecutionAllowed === true')) failures.push('ACTIVE_POLICY_GATE_MISSING');
if (!source.includes('executionTransportConnected === true')) failures.push('TRANSPORT_GATE_MISSING');
if (!source.includes('executionCredentialUseAllowed === true')) failures.push('CREDENTIAL_GATE_MISSING');
if (failures.length) { console.error('Restricted LIVE state machine governance validation FAILED'); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('Restricted LIVE state machine governance validation PASS');
