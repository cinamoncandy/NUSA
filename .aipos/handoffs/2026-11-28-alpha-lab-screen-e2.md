# AIPOS handoff — Alpha Lab E2 screen runner (2026-11-28)

## Current work

- Parent work order: `WO-RESEARCH-20261128-CODEX-ALPHA-LAB-ENGINE`.
- Subtask: E2 offline declared-rule screen runner.
- Branch: `codex/alpha-lab-screen-runner-20261128`.
- Base: `6e908e4f9d2339775f392f9f00279192b3298f3c`.
- Draft pull request: [#3357](https://github.com/cinamoncandy/NUSA/pull/3357), created at implementation commit `12d178b1868b64224d0f07d7e85ebff194c9a029`.

## Implementation

- `scripts/alpha-lab/screen.js` defines a canonical, hashed grammar for the six daily rule families in desk batch A. It fixes 15 bp base and 30 bp stress costs, 90-day minimum history, top-five long-only ranking, six-window discovery, one-sided normal second filter, and `0.05/K` Bonferroni bar.
- The runner accepts only a sorted, exact-match KRW universe, canonical grammar, regular market files, ascending UTC-daily OHLCV rows, and history strictly before `2026-11-05T00:00:00Z`. It hashes the grammar, each input file, and deterministic output; it performs no network access.
- `tests/alpha-lab-screen.test.js` uses synthetic fixtures only. Five tests pass, including cutoff refusal before a post-cutoff row's OHLCV tokens are parsed, hash reproducibility, six-family execution, universe pinning, and row validation.

## Sources and boundaries

- Read the parent work order, the Alpha Lab completion roadmap, the cross-section e-value design, the small-farm design, the desk batch A preregistration and result, and the existing `scripts/offline-desk-a-screen.js`.
- Scope is offline, read-only, daily-history research. Keep the existing historical scripts and their result records unchanged.
- The screen input cutoff is `2026-11-04`. Never access or derive prices from `2026-11-05` through `2026-12-05`, or order-book values from `2026-11-25T19:00Z` through the work order's release date.
- No network in tests; no host, app, trading, authority, threshold, gate or capital changes.

## Evidence limits

The checked-in repository has the preregistration and recorded summary, but no raw daily OHLCV directory for desk batch 1. Existing input-fetch scripts use public network access outside the repository. Therefore the synthetic tests verify input checks, costs, fixed filters, output hashing and cutoff refusal, but they do not substantiate byte-for-byte reproduction of the historical 141-rule result. That acceptance item remains unverified. Do not claim reproduction unless an existing permitted input artifact is available and independently verified without touching the blind window.

## Next action

Push this AIPOS follow-up, verify CI against the resulting exact PR head, and keep #3357 Draft for independent non-author review. Do not alter the previous scripts or recorded results.
