# `/grill-me` Adversarial Review Protocol

Status: canonical supplement for NUSA CORE adversarial review.

This protocol defines how `/grill-me` must be executed. It supplements
`docs/NUSA_CORE_MASTER_INSTRUCTIONS.md` and `AGENTS.md`. It does not override
AIPOS, architecture, repository protection, or safety rules, and it grants no
LIVE, real-money, credential, broker-mutation, production-mutation, Audit, or
Release authority.

## 1. Purpose

`/grill-me` is a bounded, evidence-bound **pre-Audit adversarial review** of a
concrete current target. Its job is to find weaknesses that ordinary happy-path
implementation and CI can miss, drive repository-controlled P0/P1 defects to
closure, and leave a reusable review receipt for independent Audit.

It is not:

- a second Audit lane;
- a Release approval;
- a substitute for exact-head CI;
- a project-wide claim of perfection;
- permission to create a parallel queue, scheduler, control plane, merge engine,
  orchestrator, evidence authority, or trading/execution path.

A `/grill-me` PASS only means that no unresolved P0/P1 finding remains **within
the explicitly reviewed scope and available exact-head evidence**.

## 2. Resolve the target before judging it

Before making any finding or verdict, bind the review to current repository
truth:

```text
target_type
  PR | issue | commit | branch | file-set | workflow | architecture-flow

target_id
head_sha
base_sha_or_main_sha
reviewed_files_or_components
canonical_owner_or_subsystem
current_ci_runs
current_runtime_or_artifact_evidence (when applicable)
```

Rules:

1. Re-read current protected `main` and the target immediately before review.
2. Branch names, chat history, old comments, old PASS results, and previously
   observed SHAs are untrusted until GitHub confirms them.
3. For a PR, inspect the current exact head, base, mergeability, diff, changed
   files, current checks, and relevant dependencies.
4. For a workflow/runtime claim, bind evidence to exact workflow run, head SHA,
   artifact/receipt, and timestamp where available.
5. If the target cannot be resolved precisely, do not guess. Use
   `INSUFFICIENT_EVIDENCE` and state the missing evidence.

## 3. Evidence invariants

Every material claim must be traceable to evidence that can be re-read.

- Exact-head evidence is required for head-sensitive findings and validations.
- Evidence from a different head is stale unless the reviewer proves that the
  evidence is head-independent.
- Material base movement that can change behavior invalidates affected review
  evidence and requires revalidation.
- CI green is evidence, not proof that the design is correct.
- Absence of a failing test is not evidence that a failure mode is impossible.
- Absence of evidence is never converted into confidence.
- `UNKNOWN` and `INSUFFICIENT_EVIDENCE` remain unknown; they may not be silently
  downgraded into PASS.
- Never fabricate physical-device, external-service, human-acceptance, market,
  account, performance, runtime, or deployment evidence.
- `HUMAN_ENVIRONMENT_ONLY` evidence must remain explicitly human/environment
  bound.

## 4. Mandatory adversarial review dimensions

A reviewer may add dimensions, but may not omit a relevant mandatory dimension
without recording why it is not applicable.

### 4.1 Authority and safety

Challenge whether any path can weaken or bypass:

- `liveAuthority=NONE`;
- `productionMutationAllowed=false`;
- `aiAuthority=ZERO_AUTHORITY`;
- AI self-grant prohibition;
- automatic LIVE activation prohibition;
- withdrawal/transfer prohibition;
- mobile credential-storage prohibition;
- PAPER/REAL separation;
- fail-closed behavior.

Look for indirect authority escalation, alternate adapters, UI-triggered bypass,
unsafe defaults, permissive fallbacks, hidden credentials, and recovery paths
that reopen authority after failure.

### 4.2 Exact-head and stale-state safety

Challenge:

- stale head or base assumptions;
- CI/Audit receipts from an older head;
- branch-name-only verification;
- merge-ref/base movement that materially changes behavior;
- stale cache/state that can overwrite newer repository truth.

### 4.3 Replay, idempotency, and duplicate execution

Challenge repeated delivery and concurrent execution:

- duplicate webhook/workflow events;
- retry after partial success;
- replay of an old event;
- concurrent claims;
- process restart during a state transition;
- repeated merge/audit/dispatch requests.

The same logical event must not cause duplicate mutation, duplicate PRs,
duplicate orders, duplicate fills, duplicate comments that act as authority, or
competing state machines.

### 4.4 State transitions and chronology

Challenge impossible or out-of-order transitions, including:

- completion before validation;
- Audit before exact-head CI when CI is required;
- Release before current-head Audit;
- stale success arriving after a newer failure;
- retry/recovery that skips required intermediate states;
- ambiguous terminal states.

### 4.5 Canonical ownership and duplicate architecture

Identify the canonical subsystem before proposing a fix. Reject fixes that
create a second implementation of an existing canonical responsibility.

For autonomous-development orchestration, reuse canonical Issue #903 and its
existing control-plane/state/orchestration/merge-train/telemetry modules. Do not
create a second:

- queue;
- scheduler;
- dispatcher;
- control plane;
- merge engine;
- orchestration state machine;
- evidence authority.

For trading/product behavior, preserve existing Strategy -> Decision -> Risk ->
Execution separation and existing PAPER/REAL/LIVE boundaries.

### 4.6 Failure, timeout, retry, and recovery

Challenge the unhappy path first:

- timeout before/after side effect;
- dependency unavailable;
- malformed or stale input;
- partial write;
- crash/restart;
- lost lease;
- retry exhaustion;
- contradictory recovery evidence;
- upstream success with missing downstream receipt.

Retries must be bounded and must not hide a structural failure.

### 4.7 Observability and provenance

Ask whether an operator can reconstruct:

```text
input/event
-> decision
-> authority/gate result
-> mutation or no-op
-> exact state transition
-> validation
-> outcome/receipt
```

Reject unverifiable claims, mutable evidence masquerading as immutable proof,
receipts without exact-run/head binding, and telemetry that cannot distinguish
UNKNOWN from success.

### 4.8 Human/environment-only boundaries

Challenge whether repository automation is pretending to satisfy a physical,
external, or human acceptance gate. Missing human evidence must remain missing.
It may block the relevant acceptance decision, but it must not unnecessarily
halt unrelated safe repository work.

### 4.9 Product and UX truthfulness

Challenge:

- fabricated/synthetic values presented as actual;
- stale values presented as current;
- unavailable data rendered as zero;
- PAPER values confused with REAL values;
- controls that appear authoritative but cannot safely execute;
- hidden provenance or misleading labels;
- visual success asserted without physical-device evidence when required.

### 4.10 Tests and acceptance coverage

For every meaningful behavior change, ask which failure would still pass the
current test suite. Require targeted negative/adversarial tests when state,
authority, replay, recovery, provenance, concurrency, money/accounting, or
security is involved.

Happy-path CI alone is not sufficient adversarial coverage.

### 4.11 Security and trust boundaries

Challenge all external/IPC/network/process boundaries for:

- validation of untrusted data;
- authentication/authorization confusion;
- secret leakage;
- injection or unsafe interpolation;
- over-broad permissions;
- confused-deputy behavior;
- implicit trust in repository comments, labels, branch names, or client input.

### 4.12 Critical-path and operational efficiency

Challenge process defects that create avoidable delay or rework:

- hidden polling waits where repository events exist;
- repeated work already proven on the same exact head;
- unnecessary stale-head refreshes;
- duplicate implementation/research;
- handoff gaps between Development, CI Auto-Fix, Audit, and Release;
- WIP that creates conflicts without increasing verified throughput;
- reporting instead of executing an available safe action.

Efficiency findings never justify weakening safety or evidence gates.

## 5. Severity rubric

Severity must describe impact, not reviewer preference.

### P0 — stop-the-line

A defect is P0 when it can plausibly cause or permit one of the following:

- safety or authority boundary violation;
- credential/private-data compromise;
- real-money or irreversible mutation outside explicit authority;
- evidence fabrication/corruption that can authorize an unsafe decision;
- deterministic accounting/data-integrity corruption;
- a merge/release decision based on demonstrably stale or wrong authority
  evidence;
- another equivalent catastrophic or release-invalidating failure.

An unresolved P0 always yields `FAIL`.

### P1 — blocking correctness/reliability defect

A defect is P1 when it is likely to cause meaningful incorrect behavior,
critical-path failure/rework, unrecoverable or repeated operational failure,
architecture divergence, missing required negative coverage, or a material
acceptance gap without reaching P0 impact.

An unresolved P1 yields `FAIL` for the reviewed scope.

### P2 — non-blocking quality issue

P2 covers maintainability, ergonomics, cleanup, minor observability, and other
quality improvements that do not invalidate correctness or required acceptance
for the current scope.

A review with only P2 findings may be `PASS_WITH_NOTES`.

### Severity anti-gaming

- Do not downgrade severity merely to unblock CI, Audit, or Release.
- Every downgrade must cite the evidence that reduces impact or likelihood.
- If impact is uncertain at a safety/authority/integrity boundary, fail closed
  until the uncertainty is resolved.

## 6. Finding schema

Every P0/P1 finding must contain enough information for another worker to
reproduce and close it without repeating the investigation.

```yaml
id: GRILL-001
severity: P0 | P1 | P2
category: authority | stale-head | replay | chronology | architecture |
          recovery | observability | human-gate | ux-truth | tests |
          security | critical-path | other
title: concise failure statement
location:
  files: []
  symbols_or_lines: []
evidence:
  head_sha: "..."
  run_or_artifact_ids: []
  citations_or_receipts: []
failure_mode: "what sequence/input breaks the design"
impact: "what becomes wrong or unsafe"
why_existing_guards_miss_it: "test/gate/design gap"
minimal_fix: "smallest coherent repair"
verification:
  targeted_tests: []
  adversarial_tests: []
  required_exact_head_gates: []
owner: Development | CI Auto-Fix | Core | external-human
status: OPEN | FIXED | HUMAN_ONLY | INSUFFICIENT_EVIDENCE
```

P2 findings may use a shorter form but must still identify evidence and impact.

## 7. Verdict model

Use exactly one review verdict:

### `PASS`

Allowed only when:

- target/head/base are resolved;
- all relevant mandatory dimensions were reviewed;
- no unresolved P0/P1 remains in scope;
- no required safety/authority/integrity evidence is unknown;
- material claims are evidence-bound.

### `PASS_WITH_NOTES`

Same as PASS, except non-blocking P2 findings or explicitly scoped limitations
remain.

### `FAIL`

Use when any P0/P1 remains unresolved, or when a required fail-closed boundary is
known to be violated.

### `INSUFFICIENT_EVIDENCE`

Use when the review cannot establish a required fact. This is not PASS and may
not be used to authorize Audit or Release.

Every verdict must state:

```text
reviewed_scope
head_sha
base_sha
open_p0_count
open_p1_count
open_p2_count
unknowns
not_audit_approval=true
not_release_approval=true
revalidation_required_on_head_change=true
```

## 8. Remediation loop

For repository-controlled findings, `/grill-me` is action-oriented:

```text
finding
-> root cause
-> smallest coherent fix
-> targeted/adversarial validation
-> new exact head
-> invalidate old head-bound review evidence
-> fresh exact-head required CI
-> rerun /grill-me on the new head
-> independent Audit
-> Release only after current-head Audit + required gates
```

Routing:

- product/architecture/code P0/P1 -> Development through Evolve;
- concrete CI/job/log defect -> CI Auto-Fix;
- policy/architecture conflict -> Core;
- physical/external/human evidence -> explicit HUMAN_ONLY blocker.

Do not open a duplicate repair PR for the same finding. Reuse the current
canonical branch/PR when safe.

## 9. Anti-gaming rules

The following are invalid `/grill-me` behavior:

1. declaring `P0/P1=0` without a reviewed-scope/evidence receipt;
2. treating CI green as an automatic grill PASS;
3. combining CI, Audit, or runtime evidence from different heads without proving
   head independence;
4. treating missing evidence as proof that no defect exists;
5. silently changing the target halfway through review;
6. using a broad checklist to avoid inspecting the changed failure surface;
7. downgrading severity without evidence;
8. inventing a parallel subsystem to make a local test pass;
9. weakening assertions, required checks, safety/security gates, or provenance
   requirements to remove a finding;
10. representing repository comments or self-review as independent Audit;
11. claiming physical-device/human/runtime success without genuine evidence;
12. stopping at a report when an authorized, safe repository-controlled repair
    is available.

## 10. Bounded review strategy

`/grill-me` must be deep without becoming an unbounded audit of the entire
repository.

Review in this order:

1. changed/targeted failure surface;
2. direct dependencies and state transitions;
3. mandatory cross-cutting safety/evidence/authority invariants;
4. canonical ownership/duplicate-system risk;
5. highest-impact negative scenarios;
6. critical-path/process defects created by the change.

Do not turn unrelated pre-existing technical debt into a P0/P1 for the current
scope unless the target newly depends on it or materially worsens it.

## 11. Standard receipt

Use this compact receipt at the end of each completed review:

```yaml
grill_me:
  target: "PR #... | issue #... | commit ... | ..."
  head_sha: "..."
  base_sha: "..."
  scope: []
  reviewed_dimensions: []
  evidence: []
  findings:
    p0: []
    p1: []
    p2: []
  unknowns: []
  fixes_applied: []
  validation: []
  verdict: PASS | PASS_WITH_NOTES | FAIL | INSUFFICIENT_EVIDENCE
  not_audit_approval: true
  not_release_approval: true
  revalidation_required_on_head_change: true
```

If a new commit changes the reviewed head, the prior receipt remains historical
evidence only and cannot be reused as the current verdict.

## 12. Safety invariant

Every `/grill-me` run preserves:

```text
liveAuthority=NONE
productionMutationAllowed=false
aiAuthority=ZERO_AUTHORITY
AI self-grant = forbidden
automatic LIVE activation = forbidden
withdrawals/transfers = forbidden
mobile credential storage = forbidden
PAPER/REAL separation = strict
fail-closed = required
evidence fabrication = forbidden
```

Velocity, convenience, CI pressure, or an OWNER request to continue quickly may
change work priority but never weaken these boundaries.