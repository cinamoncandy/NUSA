# Learning-loop operations continuation — 2026-10-26

Protected main last freshly verified at `a49325d4677841ef76c36e9edd7939cc0c204588`; re-read live GitHub before any release transition. Preserve the original dirty owner checkout; this task is isolated in `.nusa-loop-20261026`.

## Related prior work

PR #2855 is merged. Do not revive or republish its obsolete SQLite `_findPath` repair. PR #2877 was last observed Draft at `f4f7c1bdbc44617f5b10d009467aee19e56bcb3c`, based on `4bb02f4655044122a95e3dbb94bba65844c0f0cb`; that base is behind protected main `a49325d...`. Its six old-head workflows and technical review receipt are historical. Recheck the live PR before acting; do not duplicate its cgroup I/O work.

## Current active Oracle backup helper task

PR #2885 is the single publication of `WO-OPS-20261026-BACKUP-HELPER-PROOF`, branch `codex/oracle-backup-helper-artifact-20261026`. It isolates the exact-source root helper artifact and digest so the backup job need not download/extract the full ~390 MB release bundle just to compare one helper. The full release remains in the separate activation job. Backup semantics, cgroup I/O policy, timeout budgets, retention, writer lease and PAPER authority are unchanged.

PR #2885's repair head `7b686e93c94665efea614dfef960da668a202a2c` is based on protected main `a49325d4677841ef76c36e9edd7939cc0c204588`. All six required workflows passed (CI `40259509806`, Actual PAPER `40259510207`, Capability `40259509900`, Activation `40259509810`, Transport `40259509884`, Read-only Broker `40259509891`). Fresh non-author Codex review found no major issues (receipt `6406957908`); both prior P2 review threads are resolved. The stale handoff was reconciled and work-order impact is `production_backup_safety_gate`. Focused tests passed 31/31; AIPOS YAML/provenance/drift/conformance and diff checks passed. Recheck GitHub live head/base before Audit or Release; if a later commit changes the head, these receipts are historical.

Earlier, before AIPOS reconciliation, the code-specific suite passed 31/31 and build/typecheck/validate:full/security/lint/AIPOS validators passed. Runtime benefit remains unmeasured. Prior run `40198892768` downloaded/extracted a 390,666,501-byte artifact before backup and logged a WAL checkpoint disk I/O error; logs do not prove who initiated cancellation. Do not claim timeout as the proven cancellation cause or that this workflow fix resolves the host I/O error.

## Ordered next actions

1. Recheck live protected main, PR head/base, and exact-head evidence before the next canonical transition.
2. Obtain Independent Audit and separately authorized Release; keep Draft unless both gates authorize proceeding.
3. #2770 runtime acceptance remains separate: require approved exact-main Oracle deployment, installed exact reviewed root-owned helper, actual backup/readiness evidence, genuine future PAPER fill and restart/replay continuity. No synthetic fill, risk relaxation, or duplicate writer/control plane.

Research: preserve the #2799 deferral until the orderbook study result no earlier than 2026-10-29. S2/S3/S4 and S5 holdout dates remain frozen. No premature evaluation or strategy qualification.

Overall learning-loop VERIFIED=false; investment improvement UNPROVEN. Safety: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
