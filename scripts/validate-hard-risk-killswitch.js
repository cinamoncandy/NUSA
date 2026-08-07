const { readFileSync } = require('node:fs');
const risk = readFileSync('apps/execution/src/hard-risk-gateway.ts', 'utf8');
const kill = readFileSync('apps/execution/src/latched-kill-switch.ts', 'utf8');
const failures = [];
for (const token of ['PASS','REJECT','BLOCK','UNKNOWN','KILL_SWITCH_ACTIVE','RECONCILIATION_','MARKET_DATA_','RUNTIME_','MAX_DRAWDOWN','MAX_CONCENTRATION']) if (!risk.includes(token)) failures.push(`RISK_MISSING:${token}`);
for (const token of ['KILL_SWITCH_TWO_HUMAN_APPROVERS_REQUIRED','KILL_SWITCH_RELEASE_UNSAFE','kind: "HUMAN"','hardRisk !== "PASS"','reconciliation !== "MATCH"','marketData !== "HEALTHY"']) if (!kill.includes(token)) failures.push(`KILL_MISSING:${token}`);
for (const forbidden of ['submitOrder(', 'cancelOrder(', 'amendOrder(', 'withdraw(', 'resolveCredential(', 'connectExecutionTransport(']) {
  if (risk.includes(forbidden)) failures.push(`RISK_FORBIDDEN_SURFACE:${forbidden}`);
  if (kill.includes(forbidden)) failures.push(`KILL_FORBIDDEN_SURFACE:${forbidden}`);
}
if (failures.length) { console.error('Hard risk / kill switch validation FAILED'); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('Hard risk / kill switch validation PASS');
