# Handoff: Alpha Lab V1 / F2b synthetic e-process comparison

- Work order: `WO-RESEARCH-20261128-ALPHA-LAB-F2B-EVALUE-POWER`
- Branch: `codex/WO-RESEARCH-20261128-ALPHA-LAB-F2B-EVALUE-POWER`
- Base: `5846d6b58b4fa7f5aff7ea7b746a8fc8f3222e92`
- Scope: offline synthetic experiment only; no host, workflow, UI, real-market data, or order path.

## Plan recorded

- Reuse the existing F2 synthetic assumptions without changing the F2 source.
- Compare hold lengths using the same per-day IC parameterization.
- Measure the existing proposed e-process against the listed alternatives; do not choose/adopt a method or alter alpha/gates.
- Include a skewed zero-raw-mean null to show where the clipped-mean test differs from raw-mean intuition.
- Freeze the analysis script hash before one primary simulation; use tests/self-test for development, not repeated primary runs.

## Next

Implementation and the one frozen primary run are complete locally. The simulator and tests are commit `403e4641db0bde7ed9d9fc1410ef97b5545f08e2`; result artifact and note are recorded in commit `a3835fc587f4a9205f037bc3ecd138c87f9c5f2b`. Analysis script SHA-256 is `5439dcee3c9c25e3fce81512770eb66fd31cc778fc4069a3361384e8273dd1be`. The primary artifact is `docs/research-data/alpha-lab-f2b-evalue-power-2026-11-28.json` (SHA-256 `1901d4dac5b03323b9aa3f800c7fbf4d7d4b8f0561ad128f3fe273894ee6e562`) with interpretation limits in `docs/ALPHA_LAB_F2B_EVALUE_POWER_RESULT_2026-11-28.md`.

Local checks passed: focused tests 7/7, self-test 46 checks, focused ESLint, AIPOS YAML/index, `pnpm run preflight`, and `pnpm run ai:architecture`. After the primary run, a test-only adjustment removed an invalid assumption that the result file would still be absent and now checks a side-effect-free module import in a child process; the analysis script SHA and artifact were not changed or rerun. Artifact/config/script hashes were revalidated from the files. Next commit the artifact, result note, and AIPOS evidence; push the branch, open one draft PR, and verify exact-head CI. Independent review remains pending; do not merge or register a strategy.

Safety: `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / realOrderAuthority=false / realTransferAuthority=false / aiAuthority=ZERO_AUTHORITY / FAIL_CLOSED`.

## Owner-supplied review follow-up (2026-11-28)

- The independent report supplied by the owner reviewed prior head `20124ea9d1bf5a41a9afc0432f1a1c64b9277a0d` as `ACCEPT WITH P2` (0 P0/P1, 2 P2); it did not independently rerun the simulation.
- The reviewer read the result JSON but did not rerun the 1,000-replication primary simulation; this remains a non-independent simulation result.
- The result note now clarifies that `dailyIC` is the configured model parameter, not measured realized cross-sectional Pearson/Spearman IC, and that per-cell Wilson intervals do not quantify differences across hold lengths with separate seeds.
- This is a documentation-only clarification. The simulation script, JSON artifact, and hashes are unchanged; the one-time primary run was not repeated.
- Updated documentation head `318c5105254a23ec66f47228ade4e320c95a7f2f` passed exact-head CI #15004 and Actual PAPER evidence #10649. The corresponding AIPOS state update is evidence-only; fetch the latest PR head and its CI before review.
- Obtain a fresh non-author review of the latest head. Keep PR #3352 in draft; do not select or register a strategy.
