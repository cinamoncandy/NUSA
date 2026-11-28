# Handoff: Alpha Lab A1 hypothesis registry

- Work order: `WO-RESEARCH-20261128-ALPHA-LAB-HYPOTHESIS-REGISTRY`
- Branch: `codex/WO-RESEARCH-20261128-ALPHA-LAB-HYPOTHESIS-REGISTRY`
- Base: `11058d27b50e518f764fe7ffb17e5be2e498a14b`
- Draft PR: [#3351](https://github.com/cinamoncandy/NUSA/pull/3351), initial implementation head `ed46793f604a9146441caa02d697596c7f230c64`.
- Scope: offline prospective-hypothesis registry core only.

## Implemented

- Added a local JSONL event registry with canonical frozen specs, explicit family K slots, append-only events, hash-chain validation, and fail-closed event transitions.
- Blocks data-access markers until all K slots for that family are registered.
- Preserves negative verdicts; a newly recorded, unadjudicated result keeps the projected state pending.
- Added CLI and usage/integrity documentation. No production ledger or hypothesis was created.
- No historical result was backfilled. No market data, order book, order, account, risk, service, workflow, or UI path is touched.

## Validation so far

- `node --check scripts/alpha-lab/hypothesis-registry.js`: PASS.
- `node --test scripts/alpha-lab/hypothesis-registry.test.js`: 13/13 PASS.
- `git diff --check`: PASS.
- `node scripts/aipos-work-order-index.js --check`: PASS.
- `node scripts/validate-aipos-yaml.js`: PASS (832 YAML files parse strictly; no duplicate keys).
- `XDG_DATA_HOME=/workspace/.local/share pnpm run preflight`: PASS.
- `pnpm install --frozen-lockfile --ignore-scripts`: PASS using `XDG_DATA_HOME=/workspace/.local/share`; lockfile unchanged.

## Caveats and next actions

- Registration attestation and recorded timestamps are not cryptographic proof of prior data non-access or trusted time.
- The hash chain detects partial edits but a full ledger rewrite can recompute it; repository history and independent review are still required.
- Evidence references/hashes are recorded but referenced artifacts are not opened or independently verified.
- Inspect the latest exact-head CI for PR #3351 and keep the PR draft and work order `IN_PROGRESS` pending the owner's independent review. Do not merge, release, or register a real hypothesis as part of this implementation.

Safety: `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / realOrderAuthority=false / realTransferAuthority=false / aiAuthority=ZERO_AUTHORITY / FAIL_CLOSED`.
