# Independent review automation: design (2026-11-14)

Status: DESIGN PROPOSAL. Owner decision 2026-11-14: "독립 검토 자동화해" (automate the independent review). This note adds no workflow, secret,
permission, label or runner change. Building the workflow is a later PR that needs the owner's answers in section 7 and a non-author review. Safety
stays: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. An automatic review is never an Audit or
Release approval and never merges, approves or un-drafts anything.

## 1. Today

The non-author review is done by Codex on a ChatGPT account; the owner copies the PR text into it and pastes the answer back (2 to 5 round trips per PR).
The review is static (it reads the diff and the repository on GitHub), it does not run tests, and it names its head SHA.

## 2. What the repository already has (read 2026-11-14)

- A self-hosted runner labelled `nusa-codex-autopilot`, logged in to a dedicated ChatGPT account, runs `codex exec -s workspace-write` in
  `autopilot-codex-coding.yml` (`codex login status` first).
- That runner shares the 1 GB PAPER host, so the workflow uses `scripts/autopilot-codex-host-guard.sh`: Codex starts only with enough free memory and no PAPER release
  running, runs under `nice` and `ionice`, loses the Actions token, has heavy tools blocked, and is stopped when the host needs the memory. The guard runs from an
  immutable copy outside the tree Codex can write.
- A hosted `publish` job does the writing (branch, PR); Codex itself never commits, pushes or opens a PR.
- That workflow triggers on `pull_request_target` and checks out only the trusted base ref.

The review automation reuses this pattern. It needs no API key and no new third party.

## 3. Threats and the rule that answers each

| Threat | Rule |
| --- | --- |
| The PR under review contains text that tries to steer the reviewer (prompt injection) | The reviewer runs with `-s read-only`, no Actions token, no network tools it can use to write, and its output is only text. The prompt, protocol and runner settings come from the trusted base ref, never from the PR |
| A PR edits the review workflow to weaken it, or to run code on the PAPER host | Trigger is `pull_request_target` or `workflow_dispatch`, so the workflow definition is the one on `main`. The PR head is checked out only as data into a separate directory and no script from it is executed. A PR that changes the review workflow or its prompt is reviewed by the previous version plus the owner |
| The review job writes to the repository or approves | The review job has `contents: read` only. A separate hosted job with `pull-requests: write` posts ONE comment per (PR, head SHA). No `APPROVE` or `REQUEST_CHANGES` review event is ever created |
| The comment leaks something | The comment is the reviewer's text with a fixed header and the head SHA; it is length-capped; the review job gets no secret and no environment value; a test greps the workflow for any secret use in the review job |
| The PAPER host is starved | Same host guard, one review at a time (`concurrency`), deferred (not failed) when memory is low or a release runs; PAPER always wins |
| The owner's ChatGPT usage is spent | Review runs only on an explicit trigger (section 4), one run per head SHA, and stops with a clear comment on a usage limit; no automatic retry loop |
| An old review is mistaken for the current head | The comment states the head SHA; a later head makes the earlier comment stale, and the automation never says ACCEPT for a SHA that is no longer the PR head |
| The author agent steers the reviewer | The author cannot change the prompt or the runner for its own PR (previous rule); the verdict text is data to a human, not a command to any agent; nothing acts on it automatically |

## 4. Trigger

- `workflow_dispatch` with a PR number (always available).
- A label `needs-independent-review`, added by the agent when a PR is ready for review (labels need `issues: write`-class access that the agent token has).
  A push does NOT retrigger; the agent re-adds the label after a new head. This limits the usage cost.
- Draft PRs are reviewable (the review is what lets a draft become ready).

## 5. What the comment says

Fixed header "Independent review (automatic, Codex), head <sha>, not an Audit or Release approval", then the verdict (ACCEPT, ACCEPT WITH P2, REJECT) with P0/P1/P2, the
scope ("static review of this head; no tests or CI were run by the reviewer"), and the fixed footer required for Claude-authored posts is NOT used here because Codex is the
author of the text (the posting job adds only its own marker). Whether the verdict counts for un-drafting is the owner's decision (section 7).

## 6. Phases

| Phase | Change | Needs |
| --- | --- | --- |
| R1 | This design, reviewed | non-author review (by hand, the old way) |
| R2 | The workflow with `workflow_dispatch` only, review job on the Codex runner, hosted post job, tests for the rules in section 3 | owner approval for `pull-requests: write`, the use of the dedicated ChatGPT account and the runner; non-author review; authority map entry |
| R3 | The label trigger | owner approval after R2 has produced reviews that the owner judged equal to the manual ones on at least 3 PRs |
| R4 | Optional: treat the automatic review as the non-author review in the draft rule of `CLAUDE.md` | owner decision; governed instruction change; independent review |

## 7. Questions for the owner (the agent proceeds with R1 only)

1. May the automatic review use the dedicated ChatGPT account on the `nusa-codex-autopilot` runner (it shares the PAPER host; the host guard defers it)?
2. May the posting job have `pull-requests: write` (comment only, never approve)?
3. Should a verdict from the automatic review count as the non-author review that lets a draft become ready (R4), or stay advisory beside the manual one?

## 7a. Owner answers so far

- Question 3 (2026-11-14, owner: "인정한다"): the owner accepts that a verdict from the automatic review may count as the non-author review that lets a draft become ready. This is the intent behind R4. It does
  not switch anything on: R4 still requires R2 and R3 to have produced reviews the owner judged equal to the manual ones, and a governed, independently reviewed change to the draft rule in `CLAUDE.md`. Until then the
  manual review stays the one that counts.
- Questions 1 and 2 (use of the dedicated ChatGPT account and runner; the comment-only `pull-requests: write` permission) are NOT answered. R2 does not start without them.

## 8. Not claimed

The reviewer is a model: it can miss defects. It has no CI or runtime result. The runner's availability and the account's usage limits were not checked (the agent token cannot
read runners). Nothing here reduces a safety check.
