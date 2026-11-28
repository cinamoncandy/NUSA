# AIPOS handoff — registered breadth staged look workflow (2026-11-28)

## Current work

- Work order: `WO-RESEARCH-20261128-CODEX-BREADTH-LOOK-WORKFLOWS`
- Status: locally validated, pending commit and Draft PR.
- Branch: `codex/breadth-look-workflows-20261128`
- Base: `6e908e4f9d2339775f392f9f00279192b3298f3c` (`origin/main` when the branch was prepared).
- Pull request: not opened yet.

## Scope and safety

The change adds the registered Upbit daily-candle fetch and staged-look script, its manual GitHub-hosted workflow, and synthetic-only tests. It does not touch host or app code, order paths, releases, gates, thresholds, capital, or authority.

Only the registered market symbols were extracted from the registered pool fields plus KRW-BTC. No numeric market values or market history were read or used. The fetch and look commands have date guards; no real fetch or look has been run. Tests use synthetic candles and no network.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, and `aiAuthority=ZERO_AUTHORITY`.

## Validation

- `node --check scripts/alpha-lab/breadth-look.js`: PASS.
- `node --test tests/alpha-lab-breadth-look.test.js`: PASS; synthetic candles only.
- Workflow action-pin, action-input, and authority-map validators: PASS.
- `pnpm run preflight`: PASS.
- `pnpm run validate:full`: PASS.
- `pnpm run aipos:provenance`: PASS.
- `git diff --cached --check`: PASS.

## Next permitted action

Stage the scoped implementation and AIPOS records, run the staged diff check, commit and push, then open one Draft PR. Keep it in Draft for independent review and exact-head CI. Do not merge, release, access a host, run a real fetch/look early, or change safety authority.
