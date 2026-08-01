# NUSA Open PR Classification

Audit date: 2026-08-01
Base SHA: `10ad991ee9cded7f7784064641dd87dbc79c1c69`

Classifications are based on GitHub changed-file lists and comparison with
current `main`. No unique unmerged work was deleted.

| PR | Classification | Unique work | Action | Status |
| --- | --- | --- | --- | --- |
| #44 | STILL_RELEVANT | AIPOS state, CI, coverage, E2E lifecycle | Keep as Draft recovery PR | OPEN |
| #40 | NEEDS_OWNER_DECISION | Strategy registry and tests | Prioritize or defer | OPEN Draft |
| #39 | REQUIRES_REBASE | Production release docs/scripts/tests | Rebuild on current main | OPEN Draft, conflicting |
| #38 | NEEDS_OWNER_DECISION | Live operations layer and tests | Owner scope decision | OPEN Draft |
| #37 | NEEDS_OWNER_DECISION | Live risk gateway and kill switch | Owner safety decision | OPEN Draft |
| #36 | REQUIRES_REBASE | Release engineering/backup tooling | Rebuild on current main | OPEN Draft, conflicting |
| #33 | NEEDS_OWNER_DECISION | Durable execution and recovery | Owner sequencing decision | OPEN Draft |
| #32 | NEEDS_OWNER_DECISION | Desktop/mobile integration | Owner scope decision | OPEN Draft |
| #31 | NEEDS_OWNER_DECISION | Read-only credential integration | Security/scope decision | OPEN Draft |
| #29 | NEEDS_OWNER_DECISION | Legacy renderer loading and large legacy surface | Do not close without owner review | OPEN, conflicting |
| #21 | REQUIRES_REBASE | Backtest dust-position fix | Rebase before review | OPEN Draft |
| #6 | NEEDS_OWNER_DECISION | Legacy web/mobile paper stack and core package | Preserve until owner decides | OPEN Draft |

PR #34 and #35 were previously fully superseded by merged PR #42 and were
closed with explanatory comments. No open PR was closed in this audit because
each remaining PR contains unique work or an ambiguous legacy scope.

## Exact current open set

Open PR count: 12. Draft count: 11. The base for PRs #31-#40 and #44 is
`main`; PRs #6, #21, and #29 use the obsolete
`agent/electron-upbit-paper-trading` base.
