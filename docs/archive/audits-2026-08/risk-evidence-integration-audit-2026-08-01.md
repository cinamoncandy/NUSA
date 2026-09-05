# Risk Evidence Integration Audit

- Scope: immutable, queryable, recovery-surviving Risk decision evidence
- Verification: `CI=true pnpm.cmd run build` PASS
- Verification: `node --test tests/risk-evidence.test.js` PASS, 1/1

The GlobalRiskGateway now accepts a queryable RiskEvidenceRepository. The SQLite implementation is append-only with a primary key on decision ID, supports result/execution filters, and survives close/reopen recovery. APPROVED, REJECTED, BLOCKED, and UNKNOWN decisions are covered.
