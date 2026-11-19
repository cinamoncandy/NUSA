# Cloudflare removal S2: design of the shadow replacement for the Worker's release check (2026-11-19)

Status: DESIGN ONLY, for review. Phase S2 of `docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md`, after the S0 inventory and the S1 findings (`docs/CLOUDFLARE_REMOVAL_S1_FINDINGS_2026-11-18.md`). It changes no code, workflow, Cloudflare setting or host. Nothing is removed. The owner decides the open points in section 6.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD, orders OFF.

## 1. What was read (main 841038612, 2026-11-19)

- The Worker is in the merge path of every PR today. `autopilot-deterministic-audit-release.yml` ran for each merge on 2026-11-17 to 2026-11-19 (about 25 runs, all successful). The workflow calls `POST /control-plane/release-check` twice: once as "Verify durable control-plane Release clearance" and again as "Re-verify durable control-plane clearance before merge".
- The call sends repository, PR number, head SHA and base SHA with a GitHub OIDC token (audience `nusa-autopilot`). The workflow fails unless the answer is `accepted=true`, `status=RELEASE_CONTROL_CLEAR`, the same repository, PR number, head and base, `globalReleaseFreeze=false`, `holdState` NONE or CLEARED, and the three safety facts (`liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`).
- Everything else the workflow checks is already in Actions and does not need the Worker: PR open and not a draft, no `hold` label, head and base unchanged, canonical P0 serialization, the exact-head authorization status, branch-protection propagation.
- So the Worker contributes exactly two switches that live outside git: the control-plane HOLD (Durable Object) and the global freeze (`NUSA_GLOBAL_RELEASE_FREEZE` in the deployed Worker configuration).

## 2. Proposed replacement: one file on main, read from the audited base

`config/release-control.json`:

```json
{ "schemaVersion": 1, "globalReleaseFreeze": false, "holdState": "NONE", "liveAuthority": "NONE", "productionMutationAllowed": false, "aiAuthority": "ZERO_AUTHORITY" }
```

A new script `scripts/release-control-check.js` (pure, no network) takes the file content read **from the audited base SHA** (`gh api repos/.../contents/config/release-control.json?ref=$AUDITED_BASE`, not from the PR head, so a PR cannot clear its own gate) plus PR number, head and base, and returns the same fields the Worker returns. It fails closed on: read failure, invalid JSON, unknown or missing field, `globalReleaseFreeze` not exactly false, `holdState` not NONE or CLEARED, any safety fact different.

## 3. The file must be owner-only

Today a `main` merge can redeploy the Worker configuration, so the freeze is not owner-only either. For the file:

1. A PR that touches `config/release-control.json` is never auto-merged. The audit workflow refuses it by a path rule (a tested step, fail closed) and it can only be merged by the owner by hand. Setting the HOLD or the freeze, and clearing it, stay owner actions recorded in git history.
2. `CODEOWNERS` lists the file under the owner as a second, visible marker. It is not the control: the control is the path rule above plus branch protection.
3. S1 still has to read and record the branch protection and merge permissions (who can merge, whether administrators bypass). Without that record the file is only as strong as the unrecorded settings.

## 4. Shadow run (S2) without any change of authority

- Add a non-gating step after each of the two Worker calls: run the replacement, compare its answer field by field with the Worker's answer, print one fixed line `RELEASE_CONTROL_SHADOW match=<true|false> detail=<codes>`, and never fail the job. The Worker stays authoritative.
- Evidence rule from the proposal: 20 consecutive PRs, at least 3 touching workflows or release paths, identical decisions, zero mismatches; a mismatch is root-caused and the count restarts at 0. The count is read from the job logs of the audit runs; a small read-only script lists the last runs and their shadow lines.
- Rehearsal cases required before S3 (each must fail the merge): file unreadable, freeze true, HOLD active, a safety fact missing, a race (HOLD set between the first and the second read), a PR that edits the file.

## 5. Not in this step

The execution consumer, event bridge, coding routes, Coordinator WIP slots and the scheduled reconciliation are separate S2 items (inventory section 1, marked CONFIRM). The audit path above is the only one every merge depends on, so it goes first. `apps/autopilot` and the five Cloudflare workflows are untouched until S4.

## 6. Owner decisions needed

1. Home of the HOLD and the freeze: the file above (recommended: reviewable in git, no external store) or a protected GitHub Environment with required reviewers.
2. The path rule that blocks auto-merge of the file (section 3.1) is a change to the merge path itself and needs the normal independent review before it is built.
3. Whether the owner wants S2 started now. Cost: one extra step per audit run and no new secret. Risk if built wrong: the shadow step could break the audit job, so it is written to never fail the job and is reviewed first.

## 7. Next

On owner agreement: implement `scripts/release-control-check.js` with its tests and the two shadow steps (one PR, independent non-author review, the authority map updated by the same PR). Until then the Worker check is unchanged.
