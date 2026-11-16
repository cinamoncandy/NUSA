# CORE and Codex: who builds what, who reviews (2026-11-16)

Status: proposal for the owner. It changes no code, host or authority. Safety is unchanged: PAPER_ONLY, `liveAuthority=NONE`,
`productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF, Release=HOLD. It follows `AGENTS.md` (operating roles):
a code or workflow PR is reviewed by the role that did not write it, in a fresh session, and no AI merges or approves its own PR.

## 1. Rule of the split

- Every PR has one author and one reviewer from the other side. CORE (Claude) authors some tracks and Codex reviews them; Codex authors
  other tracks and CORE reviews them. Nobody reviews their own PR; neither merges (the release bot merges after green CI).
- Tracks are split by FILES so two authors never edit the same file at the same time.
- The owner is only the courier: one kickoff message per Codex track (below), then everything goes through GitHub (PR, review comment,
  work order). The owner does not carry code or logs between the two.
- Host actions (release, install, rollback, sudo hand-over, start/stop) stay with CORE and the owner's per-step "승인". Codex never
  touches the host and never has a credential for it.

## 2. Tracks

| Track | Content | Author | Reviewer | Files it owns |
| --- | --- | --- | --- | --- |
| A. Host control | controller `release` verb (C4), phone workflow and sudo hand-over (C5), installer, release workflow outcome contract | CORE | Codex | `deploy/control/**`, `deploy/oracle/**`, `.github/workflows/oracle-*`, `tests/nusa-control*` |
| B. Cleanup | C6 deletions: retired release-decision logic after the first controller release, unused `apps/desktop` and `apps/execution` parts, replaced workflows; Cloudflare S1 to S5 | Codex | CORE | `apps/desktop/**`, `apps/execution/**`, Cloudflare worker/coordinator files, retired workflows |
| C. Runtime health | separate the 14 s research job from the collector process (the cause of the hourly stall), event-loop budget tests | Codex | CORE | `apps/cloud/src/research*`, `scripts/research-*`, new process boundary tests |
| D. Strategy and permit | C7 strategy review of the evidence, later the permit producer and store (after a candidate qualifies) | CORE (design, producer) with Codex as reviewer; Codex writes the independent statistical review of the evidence | the other side | `docs/research-ledger/**`, `apps/cloud/src/paperTradePermission*` |
| E. Watch and ops | health watch, daily host check, dead-man check | CORE | Codex | `.github/workflows/health-watch.yml`, `scripts/health-watch*` |

Overlap rule: a change that needs a file owned by the other side goes in a separate PR opened by that side's author, or waits.

## 3. How a Codex track starts

One kickoff message per track from the owner: the work-order id, the track row above, the files it owns, and the standing rules
(AGENTS.md, AIPOS recovery, one task = one branch `codex/<work-order-id>` = one draft PR, tests and preflight before pushing, report what
was and was not verified). The first output is a plan (a list, no code) shown in the PR or the conversation; CORE answers it before code.

## 4. How CORE reviews a Codex PR

Fresh review under `docs/GRILL_ME_PROTOCOL.md`: read the diff against the work order, run the tests named there, try one mutation of the
change, check that no limit, threshold, capital, gate or authority moved, then comment APPROVE or REJECT on the PR. A REJECT names the
blocking finding and what proof would clear it. Codex fixes on the same branch; CORE reviews again.

## 5. What stays with the owner

- Every host step ("승인" per release, install or rollback), the sudo hand-over session, and Stage B (orders ON) which needs a fresh
  written approval.
- Decisions the tracks surface: the governance specifics (approving identity, revocation, version retirement), whether to separate the research
  process (track C is a larger change than the controller work), and the order of the tracks.

## 6. Order (proposal)

1. Now: A continues (C4 design is in review); B starts with the audit list (no code); E is done.
2. Next: C starts with a plan; A implements `release` after the design is approved.
3. Later: B deletions in small PRs as each replacement passes; D waits for a candidate (C7 evidence, the 2026-11-21 results, the 2026-12-13 verdict).
