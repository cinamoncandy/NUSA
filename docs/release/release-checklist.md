# Release Checklist

- [ ] Clean branch and expected commit recorded
- [ ] Version is valid `Major.Minor.Patch`
- [ ] Preflight, typecheck, lint, unit/integration tests pass
- [ ] UI tests pass
- [ ] Recovery, risk, reconciliation, Paper, and Shadow regression tests pass
- [ ] Windows package validation passes
- [ ] `release:manifest` generated build manifest and SHA256
- [ ] Capability descriptor verified
- [ ] `productionMutationAllowed=false`
- [ ] Diagnostics bundle contains no secrets
- [ ] Backup manifest and restore verification completed
- [ ] Review and rollback plan recorded

Never mark an unavailable external service as successful. A missing Windows packaging environment is a release blocker, not a pass.
