# AIPOS handoff — Alpha Lab E4 programme ledger (2026-11-28)

## Current work

- Parent work order: `WO-RESEARCH-20261128-CODEX-ALPHA-LAB-ENGINE`, subtask E4.
- Branch: `codex/alpha-lab-programme-ledger-20261128`.
- Base branch: E1 `codex/alpha-lab-registry-20261128` at `7f8aaf0d749b6bab8d82a49b23633dbc0ee31767`.
- Draft pull request: [#3358](https://github.com/cinamoncandy/NUSA/pull/3358), created at initial implementation commit `88c42916ed215b8ba353ec15090b5d8b5d16560b`.
- The PR targets the E1 branch because E4 imports the E1 reader. The repository pull-request CI trigger is main-base-only, so full CI is dispatched manually for this stack. Run `46124245841` passed on head `838ced21ff29aa9dbb887604006935ab2b5898be`; later metadata commits change the PR head and require a fresh dispatch. The live PR checks are the source of truth and must match the current head SHA.

## Implementation

- `scripts/alpha-lab/programme.js` imports E1's `readRegistry()` so every report/check validates the canonical event chain and state transitions.
- `research/alpha-lab/programme.json` sets the documented assumed `annualAlpha` to `0.05`; the owner can change the config value without editing code.
- `report` groups registered hypotheses by registration calendar year and reports test count, alpha spent, remaining alpha, open look IDs/dates, config hash, and registry head hash.
- `check <hypothesis.json> <year>` validates the candidate against the E1 schema and returns a distinct nonzero exit code when its alpha contribution would exceed that year's budget. It never writes registry rows.
- Five tests use only temporary synthetic hypotheses and registries. They verify yearly accounting, open-look reporting, exact-budget pass, over-budget refusal, no registry mutation, and fail-closed invalid registry/config behavior.

## Limits

The work order requires the E4 ledger to be read-only. Therefore `check` is a budget gate/precheck, not a registry writer; the future registration workflow must require its successful result. The E1 `register` command is not modified here, so direct bypass remains possible until the registration workflow consumes E4's check. No real hypothesis was registered.

## Next action

Read the live checks for the current PR head, preserve Draft, and await independent review. No merge or release action.
