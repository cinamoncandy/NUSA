# Cloudflare removal S3: design of the switch from the Worker's release check to the file in git (2026-11-20)

Status: DESIGN, not an approval; nothing here changes the merge path, the Worker or any workflow. Follows `docs/CLOUDFLARE_REMOVAL_S2_DESIGN_2026-11-19.md` (S2 shadow merged as #3204). Phase S3 of `docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md`.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD, orders OFF.

## 1. Where S2 stands (read 2026-11-20)

- Evidence count: 14 identical CLEAR decisions at the time of #3220, then 7 more read from the job logs (#3221, #3222, #3223, #3225, #3224, #3226, #3227), all `match=true` on both checks, no HOLD, no mismatch, no `match=na`. The line of #3228 and #3229 was not read yet. Total at least 21, the bar is 20. One audit run failed (#3223, a transient failure) and the same PR passed on its re-run.
- The bar also asks for at least 3 PRs that touch workflows or release paths. The docs define no path list; on 2026-11-20 the owner agreed ("그래") to read it as "changes `.github/workflows/**`". Four PRs qualify (#3217, #3223, #3226, #3228, all `oracle-host-diagnose.yml`). Counting launcher or deploy files would add two more but is not used.
- What the count does not show: every decision was CLEAR. No HOLD and no freeze was ever present, so the replacement has never been seen refusing anything. The rehearsal cases of S2 section 4 are therefore required, not optional, before the switch.

## 2. What S3 changes

Two things, in this order, each its own PR:

1. **S3a, the file is protected (no change of authority).** The audit workflow refuses to auto-merge a PR that touches `config/release-control.json`, `scripts/release-control-check.js` or the shadow step itself (a tested, fail-closed path step, S2 section 3.1). `CODEOWNERS` lists them under the owner as a visible marker only. A PR that edits the gate can then only be merged by the owner by hand. The Worker stays authoritative.
2. **S3b, the switch.** The replacement becomes the authoritative check; the Worker call stays for a while as the non-gating shadow (the roles reversed), so a disagreement is still printed and counted. Because this PR changes the merge path itself, it is merged by the owner by hand, after the independent non-author review and the rehearsal below. Nothing else (Worker, Durable Object, the five Cloudflare workflows, `apps/autopilot`) is touched; they are removed in S4, never in S3.

## 3. Rehearsal before S3b (each case must fail the merge, never pass it)

Run on a throwaway branch or a dispatch-only copy of the workflow, never on a real merge, with the replacement as the authority:

| # | Case | Expected |
| --- | --- | --- |
| 1 | the file cannot be read from the audited base (404, API error) | refuse |
| 2 | invalid JSON, an unknown or missing field, a wrong type | refuse |
| 3 | `globalReleaseFreeze` true | refuse |
| 4 | `holdState` active | refuse |
| 5 | a safety fact missing or changed (`liveAuthority`, `productionMutationAllowed`, `aiAuthority`) | refuse |
| 6 | HOLD set between the first and the second read | refuse at the second read |
| 7 | a PR that edits the file (read from the PR head instead of the base must not clear itself) | refuse, and the path rule blocks auto-merge |
| 8 | the answer for another PR number, head or base | refuse |

The rehearsal output (the printed lines, no secrets) is recorded in an evidence PR before S3b is merged. A case that passes is a bug in the replacement and stops S3b.

## 4. Why it is safe to try, and what can go wrong

- The file is read from the **audited base**, so a PR cannot clear its own gate; with the path rule, it cannot edit the gate and merge itself either.
- Fail closed everywhere: any doubt means the merge stops. The cost of a wrong refusal is a blocked merge that the owner can see and fix; the cost of a wrong clearance would be an unchecked release, so the design accepts false refusals and no false clearances.
- Residual risk: the Worker's freeze lives in its deployed configuration, which a main merge can currently redeploy, so today's freeze is not owner-only either. The file plus the path rule is stricter, but only as strong as branch protection and merge permissions. The S1 record of who can merge and whether administrators can bypass (S2 section 3.3) must exist before S3b. If it does not, S3b waits.
- The release bot `nusa-release-authority` must keep merging normal PRs. S3b's PR must include a real PR that goes through the new check and merges (a docs-only PR after the switch) as its proof, and the owner reads that run.

## 4b. Interaction with the release freeze and rollback

- No S3 merge or switch inside the release freeze 2026-11-24T06:00Z..2026-11-28T06:00Z; the owner merges S3b only when awake.
- Rollback of S3b: revert the one PR (the Worker stays deployed and its call stays in the workflow until S4), merged by the owner by hand. No data or host change is involved, so the rollback is a single revert.
- S4 (removal of the Worker and the five Cloudflare workflows) starts only after 20 further decisions with the roles reversed show no disagreement, and needs its own design and approval.

## 5. Owner decisions needed

1. Home of the HOLD and the freeze: the file (recommended: reviewable in git, no external store) or a protected GitHub Environment with required reviewers. S2 section 6 asked this; no answer is recorded, so it is still open.
2. Confirm the path rule for the file (S2 section 3.1): auto-merge refused, owner merges by hand.
3. Confirm that S3b is merged by the owner by hand after the rehearsal evidence, and not by the bot.
4. Date: not before the S1 branch-protection record exists; not inside the freeze.

## 6. Not done

No code, no workflow edit, no rehearsal, no switch. The Worker check is unchanged and still authoritative. Next step on agreement: S3a as one draft PR with its tests and an independent non-author review, and the S1 branch-protection read (read-only) in parallel.
