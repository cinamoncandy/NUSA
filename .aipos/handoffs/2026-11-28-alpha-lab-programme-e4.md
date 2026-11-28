# AIPOS handoff — Alpha Lab E4 programme ledger (2026-11-28)

## Current work

- Parent work order: `WO-RESEARCH-20261128-CODEX-ALPHA-LAB-ENGINE`, subtask E4.
- Branch: `codex/alpha-lab-programme-ledger-20261128`.
- Base branch: E1 `codex/alpha-lab-registry-20261128` at `3311cba0fbb6e3a5c0bcb4c5111423a9466cf1cd`.
- Draft pull request: [#3358](https://github.com/cinamoncandy/NUSA/pull/3358), current implementation commit `605b512924b4dadab83920dd55ce736e0c865d2c` before this AIPOS update.
- The PR targets the E1 branch because E4 imports the E1 reader. The repository pull-request CI trigger is main-base-only, so full CI is dispatched manually for this stack. Dispatch `46138946104` passed on exact head `b4f6ecdc0825bd08eb1b4d4984f1147a3205cff3`: validation, test, aggregate coverage, all four core shards, and UI/E2E passed; optional causal jobs skipped. The final live PR checks must be matched to the final PR head; this handoff does not duplicate mutable check state.

## Implementation

- `scripts/alpha-lab/programme.js` imports E1's `readRegistry()` so every report/check validates the canonical event chain and state transitions.
- `research/alpha-lab/programme.json` sets the documented assumed `annualAlpha` to `0.05`; the owner can change the config value without editing code.
- `report` groups registered hypotheses by registration calendar year and reports test count, alpha spent, remaining alpha, open look IDs/dates, config hash, and registry head hash. Alpha arithmetic is accumulated and compared as exact canonical decimal values; exact text fields preserve that arithmetic for audit.
- `check <hypothesis.json> <year>` validates the candidate against the E1 schema and returns a distinct nonzero exit code when its alpha contribution would exceed that year's budget. It never writes registry rows.
- Five tests use only temporary synthetic hypotheses and registries. They verify yearly accounting, open-look reporting, exact-budget pass, ordinary and floating-point-boundary over-budget refusal, no registry mutation, and fail-closed invalid registry/config behavior. Focused tests and `node --check` pass locally.
- `XDG_DATA_HOME=/workspace/.local/share pnpm run preflight` passes after the arithmetic fix; AIPOS YAML (842 files), work-order index, AIPOS drift, and `git diff --check` pass. `pnpm run aipos:truth` generated local untracked `.aipos/CURRENT_TRUTH.md` as required; it is not included in the PR.
- Exact-head CI has not yet been rerun after the arithmetic fix and base update.

## Limits

The work order requires the E4 ledger to be read-only. Therefore `check` is a budget gate/precheck, not a registry writer; the future registration workflow must call it with the actual registration year and require its successful result. The E1 `register` command is not modified here, so direct bypass remains possible and there is no atomic alpha reservation until the registration workflow consumes E4's check. No real hypothesis was registered.

## Next action

Dispatch exact-head CI for the final PR head, update the PR evidence, preserve Draft, and await independent review. No merge or release action.
