## Scope and identity

- Work order:
- Exact head / base:
- Canonical owner and risk (LOW / MEDIUM / HIGH / CRITICAL):
- Expected user value, reliability or verified efficiency impact:

## Actual verification

- Commands, environment, observation time and results:
- Changed feature / reproduction: see `docs/FEATURE_MAP.md`.
- UI change: real interaction plus screenshot/trace reference; identify mocked versus actual app/device evidence.
- Server/state change: actual request/response, negative case, restart and replay evidence as applicable.
- Performance change: bounded CPU/heap investigation and comparable before/after evidence; no raw private heap upload.
- Missing evidence / HUMAN_ENVIRONMENT_ONLY / not applicable (with reason):
- Head changed: invalidate prior head-bound verification and obtain fresh required checks.

## Safety and review

- PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; aiAuthority=ZERO_AUTHORITY.
- No credential/secret/private-customer-data artifact or broadened financial authority.
- Regression/negative tests; no weakened assertion or removed required gate.
- Independent review/Audit and canonical Release status (self-review is not approval):
- Conflict-free bounded WIP and resource/cost impact; no duplicate #903 scheduler/control plane.
