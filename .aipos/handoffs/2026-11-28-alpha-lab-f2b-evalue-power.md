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

The claimed branch and this work order are pushed before implementation. Next implement the simulator and deterministic tests, run local validation and preflight, then freeze the script hash and produce the single primary JSON/result note. Open one draft PR only after all local checks pass; no merge/release/strategy registration.

Safety: `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / realOrderAuthority=false / realTransferAuthority=false / aiAuthority=ZERO_AUTHORITY / FAIL_CLOSED`.
