# Cloudflare removal S3: design of the switch from the Worker's release check to the file in git (2026-11-20)

Status: DESIGN, not an approval; nothing here changes the merge path, the Worker or any workflow. Follows `docs/CLOUDFLARE_REMOVAL_S2_DESIGN_2026-11-19.md` (S2 shadow merged as #3204). Phase S3 of `docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md`.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD, orders OFF.

## 1. Where S2 stands (read 2026-11-20)

- Evidence count: 14 identical CLEAR decisions (`docs/FINDINGS_2026-11-20.md` section 1: 14 runs, 28 shadow lines) at the time of #3220, then 7 more read from the job logs on 2026-11-20 (#3221, #3222, #3223, #3225, #3224, #3226, #3227), all `match=true` on both checks, no HOLD, no mismatch, no `match=na`. These 7 are recorded only in this document. The lines of #3228 and #3229 were not read. Total at least 21, the bar is 20. One audit run failed (#3223, a transient failure, no shadow line) and does not count; the same PR passed on its re-run, which does.
- The bar also asks for at least 3 PRs that touch workflows or release paths. The docs define no path list; on 2026-11-20 the owner agreed ("그래") to read it as "changes `.github/workflows/**`". Four PRs qualify (#3217, #3223, #3226, #3228, all `oracle-host-diagnose.yml`); this list was made from the PR file lists on 2026-11-20 and is not in the repository elsewhere. Counting launcher or deploy files would add two more but is not used.
- What the count does not show: every decision was CLEAR. No HOLD and no freeze was ever present, so the replacement has never been seen refusing anything. The rehearsal of section 3 is therefore required, not optional, before the switch.

## 2. What S3 changes

Two things, in this order, each its own PR:

1. **S3a, the gate files are protected (no change of authority).** The audit workflow refuses to auto-merge a PR that touches `config/release-control.json`, `scripts/release-control-check.js`, `scripts/release-control-path-rule.js`, the audit workflow file or `CODEOWNERS` (a tested, fail-closed path step, S2 section 3.1; PR #3232). The Worker stays authoritative. Until S3a is on main, a PR that edits `config/release-control.json` could still be auto-merged under the Worker, so nothing else may touch those files before S3a is merged and its first real audit run has been read. S3a itself merges through the old audit (the rule is not live before it is on main); everything after it that touches a protected file is merged by the owner by hand (section 6).
2. **S3b, the switch.** The replacement becomes the authoritative check; the Worker call stays for a while as the non-gating shadow (the roles reversed), so a disagreement is still printed and counted. This PR changes the merge path itself, so it is merged by the owner by hand after the independent non-author review and the rehearsal. Nothing else (Worker, Durable Object, the five Cloudflare workflows, `apps/autopilot`) is touched; they are removed in S4, never in S3.

## 3. Rehearsal before S3b (each case must fail the merge, never pass it)

Run on a throwaway branch or a dispatch-only copy of the workflow, never on a real merge, with the replacement as the authority:

| # | Case | Expected |
| --- | --- | --- |
| 1 | the file cannot be read from the audited base (404, API error) | refuse |
| 2 | invalid JSON, an unknown or missing field, a wrong type, a duplicate key, a BOM or odd whitespace, a directory or symlink at the path | refuse (the S2 checker keeps the last of two equal keys, as JSON.parse does; the S3b gate refuses any repeated key instead, `FILE_DUPLICATE_KEY`, so an earlier HOLD cannot be hidden) |
| 3 | `globalReleaseFreeze` true | refuse |
| 4 | `holdState` active | refuse |
| 5 | a safety fact missing or changed (`liveAuthority`, `productionMutationAllowed`, `aiAuthority`) | refuse |
| 6 | HOLD set between the first and the second read | refuse at the second read |
| 7 | the PR head holds a CLEAR file while the audited base holds HOLD (a PR must not clear itself) | refuse |
| 8 | the answer for another PR number, head or base | refuse |
| 9 | stale base: the PR base lags main and a HOLD or freeze was merged to main after it | refuse (the audit requires the audited base to equal the current head of main: `current_base == current_main` in the audit job and the re-check in the release job, `autopilot-deterministic-audit-release.yml`) |
| 10 | HOLD cleared between the two reads | the first blocked read stops the gate and a re-run reads fresh; a clear after the first read cannot pass without the second read (`scripts/release-control-gate.js`, case 10 test) |
| 11 | two audits of the same PR at once, or a re-run after a new HOLD | each run reads on its own; an old `nusa/release-authorized` status is revoked or expires and cannot carry over (read the revoke steps in the workflow and check them) |
| 12 | after the switch: the Worker unreachable, or the Worker says HOLD while the replacement says CLEAR | the replacement decides; the disagreement is printed. During the reversed-shadow period a Worker HOLD also refuses (the stricter option), so a disagreement can only block, never release. Decided here so it is not left open |

The rehearsal output (the printed lines, no secrets) is recorded in an evidence PR before S3b is merged. A case that passes is a bug in the replacement and stops S3b.

## 4. Why it is safe to try, and what can go wrong

- The file is read from the **audited base**, so a PR cannot clear its own gate; with the path rule, it cannot edit the gate and merge itself either.
- Fail closed everywhere: any doubt means the merge stops. The cost of a wrong refusal is a blocked merge that the owner can see and fix; the cost of a wrong clearance would be an unchecked release, so the design accepts false refusals and no false clearances.
- Residual risk: the Worker's freeze lives in its deployed configuration, which a main merge can currently redeploy, so today's freeze is not owner-only either. The file plus the path rule is stricter, but only as strong as branch protection and merge permissions. The owner and the agents act as the same GitHub account, so a label or comment cannot prove that the owner did something; the control is the path rule plus the owner's own merge under a relaxed protection.
- The release bot `nusa-release-authority` must keep merging normal PRs. S3b's PR must include a real PR that goes through the new check and merges (a docs-only PR after the switch) as its proof, and the owner reads that run.

## 5. Freeze, rollback and who sets the freeze

- **Setting the freeze or a HOLD:** the owner edits `config/release-control.json` in a PR and merges it by hand (a protected path). The audit sees it only after that PR is on main. A freeze or HOLD merge needs no rehearsal and is allowed inside the release freeze window 2026-11-24T06:00Z..2026-11-28T06:00Z; it is the one S3 merge that is.
- **No other S3 merge or switch inside that window**; the owner merges S3b only when awake.
- **Rollback of S3b:** revert the one PR. A revert is itself a protected-path PR, so it also needs the owner's temporary relaxation of the protection and must not be done during the freeze. It is safe only while the Worker call stays in the workflow, which it does until S4. No data or host change is involved.
- **Each relaxation of the branch protection** is not recorded in git, so the owner (or the agent at the owner's word) writes the start and end time of every relaxation into the PR it was used for; the window should be as short as the merge itself.
- S4 (removal of the Worker and the five Cloudflare workflows) starts only after 20 further decisions with the roles reversed show no disagreement, and needs its own design and approval.

## 6. Owner decisions (2026-11-20: "권장대로 다 해" and "a로해")

1. Home of the HOLD and the freeze: the file `config/release-control.json`. ACCEPTED.
2. The path rule: a PR touching the protected paths is not auto-merged. ACCEPTED.
3. S3b is merged by the owner by hand after the rehearsal evidence, not by the bot. ACCEPTED.
4. Date: after the branch-protection record exists and outside the freeze window of section 5. ACCEPTED as the rule; no date is set.
5. The branch-protection consequence: the required status `nusa/release-authorized` applies to administrators too (`docs/CLAUDE_CENTERED_OPERATING_MODEL.md` line 62; the live setting is not readable by the agent), and a PR skipped by the rule gets no such status. A PR touching a protected file (including a revert of S3a, a fix to the rule, any change of the audit workflow, and S3b) is therefore merged only after the owner temporarily relaxes the branch protection for `main` in Settings and restores it afterwards. ACCEPTED by decision "a"; the protected list keeps the audit workflow file. No bypass of the required status is assumed.

## 6b. Rehearsal status (2026-11-20)

The decisions of the gate itself (cases 1-10 and 12, including the repeated key and the stale base) are implemented as a pure, unwired function `scripts/release-control-gate.js` with 12 tests (`tests/release-control-gate.test.js`), so the rule is fixed before any switch. Case 11 (concurrent audits, a stale `nusa/release-authorized` status) and the workflow glue (reading the file twice from the audited base, comparing the main head, feeding the Worker answer) are workflow behaviour and are checked in S3b by reading the workflow and by the first real run. When S3b wires the gate, `scripts/release-control-gate.js` must be added to the protected paths of `scripts/release-control-path-rule.js` (an owner-merged change under the temporary protection relaxation).

## 7. Not done

No code of S3b, no rehearsal, no switch. The Worker check is unchanged and still authoritative. S3a is PR #3232 (separate draft). Next step: S3a merged and its first real audit run read; then the rehearsal harness (a dispatch-only copy of the workflow) as its own PR with an independent review.
