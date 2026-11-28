# AIPOS handoff — Alpha Lab E5 status export (2026-11-28)

## Current work

- Parent work order: `WO-RESEARCH-20261128-CODEX-ALPHA-LAB-ENGINE`, status `IN_PROGRESS`.
- Subtask: E5 display-only Lab status export.
- Branch: `codex/alpha-lab-status-export-20261128`.
- Base branch: E1 `codex/alpha-lab-registry-20261128` at `7f8aaf0d749b6bab8d82a49b23633dbc0ee31767`.
- Implementation commit: `1c80c92234520cdb9e3d8fdf98f42b6b9c8eeb59`.
- Draft PR: [#3360](https://github.com/cinamoncandy/NUSA/pull/3360). It stacks on E1 so it can reuse the hash-chain-validating registry reader. Keep Draft; no merge or release.

## Implementation

`scripts/alpha-lab/status-export.js` reads the prospective registry through E1's validated reader and emits schema version 1 JSON to stdout. Each entry contains only `id`, `shortNameKo`, `state`, `nextLookDate`, and `lastVerdictCode`. It omits prices, returns, orders, evidence hashes, alpha values, and other numeric research metrics. A hypothesis without a verdict reports `lastVerdictCode: null` and no numeric per-hypothesis value. Terminal outcomes have no next look. The host and mobile app are not wired here; their integration is a separate CORE/UI task.

## Verification

- `node --check scripts/alpha-lab/status-export.js`: PASS.
- `node --test tests/alpha-lab-status-export.test.js`: PASS, 4/4 synthetic temporary-registry cases.
- Default CLI empty-registry output parsed as `{ schemaVersion: 1, hypotheses: [] }`: PASS.
- `XDG_DATA_HOME=/workspace/.local/share pnpm run preflight`: PASS.
- AIPOS YAML, work-order index, provenance, `git diff --check`: PASS.
- GitHub PR checks are the source of truth for exact-head CI; verify the check head SHA matches the current PR head before treating validation as complete.

## Limits and safety

No live registry rows, market data, prices, returns, orders, host code, or app code were read or changed. Missing registry is rendered as an empty list through E1's reader; corrupt registry causes an error and no JSON export. Stdout is the boundary for a separate consumer to choose its destination.

PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / realOrderAuthority=false / realTransferAuthority=false / aiAuthority=ZERO_AUTHORITY / FAIL_CLOSED.

## Next permitted action

Read the live checks on PR #3360, verify they match its current head SHA, preserve Draft status, and await the independent non-author review. No merge, release, host, or app action.
