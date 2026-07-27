# Change Control Policy (WO-0037)

## Purpose

Answers one question about any change: **what does this make untrustworthy, and where
must revalidation restart?** Every code, config, documentation, and build change is
classified, assigned a risk level, and mapped to the evidence it invalidates and the
revalidation stages it forces.

## Scope and honest status

This is a **static analysis tool over git diffs plus a declared policy matrix**. It is
self-contained and works today. Two things it is not:

- It is **not** a claim that the evidence types it names all exist. See
  "Evidence availability" below — most of the Paper/release evidence vocabulary is
  forward-looking, and the matrix records which is which.
- It does **not** enforce anything by itself. It computes a plan and exits non-zero on a
  blocker; a human still has to run the plan.

## Risk levels

| Level | Meaning |
|---|---|
| `LEVEL_0` | Documentation and other non-executing information only |
| `LEVEL_1` | UI, logging, diagnostics, tests — little direct execution-safety impact |
| `LEVEL_2` | Build, packaging, installer, evidence handling, repository tooling |
| `LEVEL_3` | Market data, runtime control, persistence, recovery |
| `LEVEL_4` | Strategy, orders, risk, kill switch, accounting, security boundary, or **unclassifiable** |
| `LEVEL_5` | Live/private capability, credential storage, or a real-order path |

`LEVEL_5` is **not an approvable level**. It produces `REJECT_CHANGE`, an empty approval
list, and an empty revalidation plan: there is nothing to schedule, because the design
has to change.

## Two fail-safe rules

1. **An unrecognised path is `UNKNOWN`, and `UNKNOWN` is `LEVEL_4`.** A file nobody
   classified is treated as dangerous, never as harmless.
2. **A semantic scan can escalate but never de-escalate.** Path is only the first
   signal. An SMA period edited inside a stylesheet is still a strategy change; a
   private-API endpoint inside a documentation file is still `LEVEL_5`.

## Shipping-path scoping (and why it exists)

A production-behaviour token — an SMA period, a risk limit, a fee formula — only proves
that *production* changed when it appears in a path that actually ships (`apps/`,
`packages/`). The same token inside `tests/`, `scripts/`, or `docs/` is fixture or
tooling data.

This scoping was added after dogfooding the analyzer on a real commit
(`d42cc50..9e24fc1`, the WO-0029 research layer). Without it, that commit — which
touched no shipping code at all — graded `LEVEL_4` purely because its test fixtures
*mentioned* `shortWindow` and `feeRate`. A gate that grades every commit `LEVEL_4`
produces noise, people learn to ignore it, and a genuine strategy change stops standing
out. That is worse than no gate.

**Security and test-hygiene rules are deliberately exempt from this scoping.** A
credential, a live-order endpoint, or an added `test.skip` is a repository-wide problem
regardless of directory, and still escalates from anywhere.

## Evidence reuse

Evidence may be reused only when it is independent of what changed:

| Change | Retained | Invalidated |
|---|---|---|
| Documentation typo | everything | nothing |
| UI copy | research, ledger | Windows GUI acceptance, artifact, RC/release |
| Installer | research, ledger | installer, upgrade, rollback, artifact, GUI, RC/release |
| Risk limit | research | risk gateway, safety drills, all Paper pilots, RC/release |
| Strategy | nothing research-related | **all** research + all Paper pilots + RC/release |
| Accounting | nothing research-related | **all** research + safety drills + all Paper pilots |
| Persistence | research, ledger math | safety drills, upgrade, rollback, Paper pilots |

The full machine-readable table is `scripts/lib/evidence-invalidation-matrix.js`. The
independent verifier checks that nothing was silently kept alive.

## Evidence availability

The matrix names 20 evidence types. Only six are producible in this repository today
(`DATASET_INTEGRITY`, `BACKTEST`, `COST_STRESS`, `WALK_FORWARD`,
`PARAMETER_ROBUSTNESS`, `REGIME_ANALYSIS`); the other fourteen are marked
`NOT_PRODUCED`. Marking a not-yet-produced type "invalidated" is meaningful policy — it
says *if you ever produce it, this change would have invalidated it* — but it must never
be read as "this evidence existed and was checked". Every result carries the
`evidenceAvailability` disclosure inline for exactly this reason.

## Fingerprints and approvals

Four fingerprints: `STRATEGY`, `CONFIG`, `RUNTIME`, `RISK_POLICY`. **Any invalidated
fingerprint invalidates every approval bound to it** — no approval survives the thing it
was granted against. Any change to `RUNTIME` requires a new release ID; artifacts are
immutable and a same-version binary replacement is never permitted.

Approval escalates with risk: maintainer (0) → +test results (1) → +release owner (2) →
+owner and safety reviewer (3) → +full revalidation plan (4) → **none possible** (5).

## Change requests, hotfixes, and rollback-first

Every change needs a change request — **including an emergency hotfix**; the analyzer
rejects a change set without one. An emergency change must additionally record that
rollback was evaluated, because **rollback is preferred over hotfix** for ledger
mismatch, duplicate fills, approval or risk bypass, persistence corruption, startup
loops, data loss, artifact mismatch, and any discovered real-order capability. "Urgent"
is never a reason to skip risk or ledger validation.

## Policy-relaxation detection

A reduced `minimum*` gate or an increased `max*` limit is detected numerically and
reported as a relaxation at `LEVEL_4` — this is the specific move of silently buying a
pass rather than earning one. Tightening a limit is also `LEVEL_4` (fingerprints still
move and regression is still required) but is explicitly *not* reported as a relaxation.

## Independent verification

`scripts/lib/change-control-verifier.js` does not call the analyzer's classifier or
semantic scanner. It runs its own, blunter scan and checks: no changed file was dropped;
a critical capability really is `LEVEL_5` and rejected; no evidence or fingerprint was
silently retained; no revalidation stage was dropped; approvals match policy;
invalidated and retained evidence partition the vocabulary exactly; no test-weakening
warning was suppressed; artifacts stay immutable; and every hash recomputes.

## Usage

```text
node scripts/analyze-change-impact.js \
  --baseline <sha> --target <sha> \
  --change-request <cr.json> --output <impact.json>

node scripts/verify-change-control.js \
  --change-set <change-set.json> --result <impact.json>
```

Both refuse to overwrite an existing output and exit non-zero on a blocker or a failed
verification.

## Known limitations

- Classification is regex- and path-based; it has no type-aware import graph, so a
  behaviour change routed through an innocuous-looking helper can be under-classified.
  The `UNKNOWN`-is-high-risk default and the escalate-only semantic scan are the
  mitigations, not a proof.
- The shipping-path rule assumes `apps/` and `packages/` are the only shipped trees. If
  that ever stops being true, this rule silently under-classifies and must be updated.
- Risk levels, the evidence matrix, and the stage mappings are declared policy, not
  derived truth. They encode a judgement and should be reviewed as such.
