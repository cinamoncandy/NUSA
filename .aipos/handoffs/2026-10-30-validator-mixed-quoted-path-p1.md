# NUSA #2772 — mixed quoted/unquoted Git path P1 handoff

## Current work

- Work order: `WO-AUTOPILOT-20261017-FRESH-VALIDATOR-GATE`
- PR: `#2772`, remains OPEN / Draft.
- Canonical branch: `fix/validator-evidence-gate-2760`.
- Latest protected main observed: `f144b940925dc04df7c0849fbaad9e5f14f5befe`.
- Remote PR head before this local successor: `d2817a60faf2126fc2351158f4188800a1fdc1d6`.
- PR base metadata returned by GitHub: `e7f8a426a57a08339eae3778ca50de6512d6acd9`.
- The local merge incorporates current main `f144b940`; the final local successor commit SHA must be resolved from Git after the merge commit.

## Finding and repair

Fresh non-author P1 `4387534372` identified a fail-closed parser gap for a Git rename header where one path is C-quoted (for example, a UTF-8 octal escape) and the other is unquoted. The parser now tries whitespace boundaries and independently decodes each token, then accepts only the unique pair matching exact changed-file metadata. Ambiguous and unsafe paths still fail closed.

Regression coverage exercises both quote orientations and an unsafe path. The existing canonical `#2772` PR is reused; no thread was self-resolved.

## Local validation

On the final local tree after current-main reconciliation, Node 24.19:

- Focused `auditRunner` tests: 36/36 PASS.
- `pnpm test`: PASS, including preflight, build, and 1,310 isolated test files.
- `pnpm run typecheck`: PASS.
- `pnpm run validate:full`: PASS, including AIPOS drift/conformance and safety invariants.
- `pnpm run security:gate`: PASS, zero unmitigated findings and zero secrets.
- `pnpm run lint`: PASS, zero errors and 47 warnings; clean protected-main lint baseline is also 47.
- Net diff check against current main: PASS.

These are local implementation checks, not independent acceptance. Exact-head CI and review are pending after successor publication.

## Next transition

Freshly verify that the remote branch still equals `d2817a60...` and protected main is still `f144b940...` (or re-evaluate if either changed). Publish one non-force successor to the existing PR branch only. Keep Draft and all review threads unresolved. Then wait for exact-head CI/companions and a fresh non-author review before requesting the separate Formal Validator.

Safety remains: `PAPER_ONLY`; `liveAuthority=NONE`; `productionMutationAllowed=false`; `realOrderAuthority=false`; `realTransferAuthority=false`; `aiAuthority=ZERO_AUTHORITY`. No Oracle mutation, Audit, Release, merge, or L2 transition is authorized by this handoff.
