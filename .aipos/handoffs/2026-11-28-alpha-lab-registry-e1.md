# AIPOS handoff — Alpha Lab E1 registry (2026-11-28)

## Current work

- Parent work order: `WO-RESEARCH-20261128-CODEX-ALPHA-LAB-ENGINE`, status `IN_PROGRESS`.
- Subtask: E1 prospective hypothesis registry.
- Branch: `codex/alpha-lab-registry-20261128`.
- Base at PR creation: `6e908e4f9d2339775f392f9f00279192b3298f3c`.
- Original implementation commit: `e094410a7cd149a6ea81ae524b8795c556d63978`.
- Append-size fix commit: `0006dd68b6b3b0671a711efe2a7400f995fafe3c`.
- Draft PR: [#3355](https://github.com/cinamoncandy/NUSA/pull/3355). The PR is draft and must remain so until independent review; no merge or release is requested.

## Decision record

The owner delegated unresolved implementation choices on 2026-11-28. E1 follows the newer work-order contract on its specified branch and paths. The older PR #3351 contains a different A1 schema and is not merged; it remains Draft and is not a substitute for the new E1 contract. No close or merge action was taken on #3351.

The frozen hypothesis JSON is canonical UTF-8 with sorted keys and one final LF. Required fields are `schemaVersion`, `id`, `shortNameKo`, `kContribution`, `alphaSpent`, `hold`, sorted unique KRW `universe`, `signal`, and ordered declared `looks`. Registration records SHA-256 and computes `firstEvaluableDate` as the next UTC calendar day. Verdict commands take a declared look ID and accept only a result file bound to the same hypothesis/look/result code with an evaluation timestamp on or after the look date.

## Implementation and verification

- `scripts/alpha-lab/registry.js`: append-only JSONL writer and hash-chain verifier; `REGISTERED`, `VERDICT`, and `RETIRED`; duplicate/early/terminal-state refusals; `register`, `verdict`, `retire`, `list`, `verify` commands.
- `research/alpha-lab/registry/.gitkeep`: empty directory marker; no live hypothesis entry.
- `tests/alpha-lab-registry.test.js`: 14 synthetic/temp-file tests. A near-limit hypothesis reproduces an append that would exceed the 16 MiB reader cap; the writer now rejects it before changing existing rows.
- `node --check scripts/alpha-lab/registry.js`: PASS.
- `node --test tests/alpha-lab-registry.test.js`: PASS, 14/14.
- `XDG_DATA_HOME=/workspace/.local/share pnpm run preflight`: PASS.
- `node scripts/validate-aipos-yaml.js`: PASS (841 files; includes this handoff).
- `node scripts/aipos-work-order-index.js --check`: PASS.
- `git diff --check`: PASS.
- Prior PR head `7f8aaf0d749b6bab8d82a49b23633dbc0ee31767`: exact-head CI PASS (required checks green; optional causal jobs skipped). The append-size fix requires fresh exact-head CI after this state update.

## Limits and safety

- No hypothesis, result, order-book data, historical/forward OHLCV, or production registry row was created or read; focused tests use temporary synthetic fixtures. The repository’s separate Actual PAPER runtime check may query a public ticker on an isolated runner; that is not E1 research input.
- Local UTC timestamps are not trusted-time attestations. A complete registry rewrite with recomputed hashes is not detectable by the hash chain alone.
- PAPER_ONLY / ZERO_AUTHORITY / FAIL_CLOSED remain unchanged. No host, app, workflow, risk gate, order path, capital, authority, merge, or release action occurred.

## Next permitted action

Verify exact-head CI after the append-size fix. Keep PR #3355 Draft and wait for non-author review before any Ready-for-review or release action. E2/E4/E5 are already proposed in their own Draft PRs; E3 and breadth are in separate authorized worktrees.
