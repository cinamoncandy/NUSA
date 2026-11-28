# AIPOS handoff — registered breadth staged look workflow (2026-11-28)

## Current work

- Work order: `WO-RESEARCH-20261128-CODEX-BREADTH-LOOK-WORKFLOWS`
- Status: Draft PR open; awaiting fresh exact-head CI and independent review.
- Branch: `codex/breadth-look-workflows-20261128`
- Implementation base: `6e908e4f9d2339775f392f9f00279192b3298f3c`.
- Draft PR: [#3359](https://github.com/cinamoncandy/NUSA/pull/3359), opened from code commit `39acf818a503dd4c58f5095fafe58b1df55e0b53`. Main was `859d218a8477f5f24c149d58dc64d392dc974e24` when the PR was opened.
- The AIPOS follow-up commit advances the PR head and requires fresh exact-head CI.

## Scope and safety

The change adds the registered Upbit daily-candle fetch and staged-look script, its manual GitHub-hosted workflow, and synthetic-only tests. It does not touch host or app code, order paths, releases, gates, thresholds, capital, or authority.

Only the registered market symbols were extracted from the registered pool fields plus KRW-BTC. No numeric market values or market history were read or used. The fetch and look commands have date guards; no real fetch or look has been run. Tests use synthetic candles and no network.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, and `aiAuthority=ZERO_AUTHORITY`.

## Validation on the code commit

- `node --check scripts/alpha-lab/breadth-look.js`: PASS.
- `node --test tests/alpha-lab-breadth-look.test.js`: PASS; synthetic candles only.
- Workflow action-pin, action-input, and authority-map validators: PASS.
- `pnpm run preflight`: PASS.
- `pnpm run validate:full`: PASS.
- `pnpm run aipos:provenance`: PASS.
- `git diff --check`: PASS.

## Next permitted action

Wait for fresh exact-head CI on PR #3359 and obtain independent review. Keep the PR in Draft. Do not run a real fetch/look, merge, release, access a host, or change safety authority.
