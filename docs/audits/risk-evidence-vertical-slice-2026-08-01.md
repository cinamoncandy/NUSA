# Risk Evidence Vertical Slice

## Evidence flow

```text
RiskContext + RiskPolicy
        |
        v
GlobalRiskGateway.evaluate()
        |
        +--> RiskDecision + timestamp/rule/input/account/market/correlation
        |
        v
RiskEvidenceRepository.append()
        |
        v
SQLite append-only risk_decision_evidence
        |
        +--> query by decision or execution
        +--> reopen database and recover identical evidence
```

## Verification

- `CI=true pnpm.cmd run typecheck`: PASS
- `CI=true pnpm.cmd run build`: PASS
- `node --test tests/risk-evidence.test.js tests/global-risk-gateway.test.js tests/runtime-command-risk-gate.test.js`: PASS, 8/8
- `git diff --check`: PASS

Risk decisions remain Paper-only and `productionMutationAllowed` remains false. The input evidence excludes the manual approval token and other credential-bearing fields.
