# NUSA Paper-Only Operations Playbook

## Purpose

This document is the single operational index for the NUSA lifecycle. It replaces ad-hoc command chains with a small, explicit state machine.

It does not authorize live trading, private exchange APIs, credential handling, automatic release, or automatic promotion.

## Current verified repository state

- Repository: `cinamoncandy/nusa`
- Active development branch: `agent/electron-upbit-paper-trading`
- Active pull request: Draft PR #1
- Application mode: Paper-only
- Latest reviewed branch CI: Windows CI run #1196, success
- Latest reviewed branch HEAD before this playbook commit: `7b2b486c2710753395c29f235217ce7d04632306`
- Unresolved inline review threads at that HEAD: none
- Release readiness: blocked pending real scenario evidence and owner review

Always re-query GitHub before relying on the values above. A newer commit or CI run makes the recorded HEAD and run stale.

## Non-negotiable boundaries

1. Automatic Paper trading defaults to OFF.
2. Restart must not reactivate automatic trading.
3. Private Upbit endpoints, live orders, credentials, JWT signing, and authorization headers remain unavailable.
4. A persistence failure must fail closed, roll back runtime mutations, fault the control plane, and block later commands.
5. CI, tests, fixtures, rehearsals, and manually edited data are not operational evidence.
6. User databases, backups, raw logs, credentials, and identifying target details must not be committed or uploaded.
7. Codex must not claim background monitoring. Operators provide completed observation records for validation.
8. Merge, release, deployment, automatic trading, and live trading are separate approvals.

## State machine

```text
DEVELOPMENT
  -> DRAFT_PR
  -> OWNER_REVIEW
  -> MERGED
  -> POST_MERGE_VALIDATION
  -> REAL_EVIDENCE_COLLECTION
  -> RELEASE_CANDIDATE
  -> LIMITED_DEPLOYMENT
  -> ROLLOUT
  -> STABILIZATION
  -> STEADY_STATE

Any state
  -> INCIDENT_CONTAINMENT
  -> INCIDENT_TRIAGE
  -> HOTFIX_DRAFT_PR
  -> HOTFIX_MERGE
  -> LIMITED_REDEPLOYMENT
  -> STEADY_STATE

STEADY_STATE
  -> MAINTENANCE_WINDOW
  -> MAINTENANCE_UPDATE_DRAFT_PR
  -> MAINTENANCE_UPDATE_MERGE
  -> MAINTENANCE_CANDIDATE
  -> LIMITED_MAINTENANCE_DEPLOYMENT
  -> MAINTENANCE_VALIDATION
  -> MAINTENANCE_CLOSE
  -> STEADY_STATE
```

No state transition is implied by a successful previous state. Each write or operational transition requires an explicit owner command.

## Command index

### Repository orientation

`INSPECT_REPOSITORY_STATE`

Read-only. Confirm branch, PR, HEAD, CI, reviews, application version, Paper-only boundary, and actual blockers.

### Development and review

- `START_CODE_WORK`: implement a specifically approved scope on a branch.
- `MARK_PR_READY`: move a fully reviewed Draft PR to Ready.
- `MERGE_PR`: merge an explicitly identified and reviewed HEAD.
- `RUN_POST_MERGE_VALIDATION`: validate the current default-branch HEAD.

### Real evidence and release

- `COLLECT_REAL_PAPER_EVIDENCE`: operator-run Paper sessions and fault drills.
- `VERIFY_REAL_PAPER_EVIDENCE`: read-only replay and provenance verification.
- `PREPARE_RELEASE_CANDIDATE`: clean build, checksums, manifest, isolated smoke test.
- `DEPLOY_LIMITED_PILOT`: deploy only approved logical targets.
- `CONTINUE_ROLLOUT`: advance exactly one approved wave.
- `ENTER_STEADY_STATE_OPERATION`: enter routine Paper-only operation.

### Incident lifecycle

- `TRIAGE_INCIDENT`: classify and contain a submitted incident.
- `START_INCIDENT_HOTFIX`: implement the smallest approved correction.
- `MERGE_INCIDENT_HOTFIX_PR`: merge only the reviewed hotfix HEAD.
- `PREPARE_INCIDENT_HOTFIX_REDEPLOYMENT`: rebuild and revalidate artifacts.
- `REDEPLOY_INCIDENT_HOTFIX`: deploy to a limited approved target set.
- `RESUME_OPERATION`: resume limited Paper-only operation.
- `RESUME_ROLLOUT`: continue the interrupted rollout one wave at a time.

### Maintenance lifecycle

- `START_MAINTENANCE_WINDOW`: safe stop, verified backup, read-only integrity checks.
- `START_MAINTENANCE_UPDATE`: implement a reviewed security or compatibility update.
- `MARK_MAINTENANCE_UPDATE_READY`: mark the reviewed Draft PR Ready.
- `MERGE_MAINTENANCE_UPDATE_PR`: merge the explicitly reviewed HEAD.
- `PREPARE_MAINTENANCE_UPDATE_CANDIDATE`: clean build and compatibility validation.
- `DEPLOY_MAINTENANCE_UPDATE_CANDIDATE`: deploy the first approved maintenance wave.
- `CONTINUE_MAINTENANCE_DEPLOYMENT`: deploy exactly one subsequent wave.
- `FINALIZE_MAINTENANCE_VALIDATION`: replay evidence, rerun required research and Integrity, export a current bundle.
- `CLOSE_MAINTENANCE_WINDOW`: append the immutable close record.
- `RETURN_TO_STEADY_STATE`: restore approved targets with automatic trading OFF.

## Explicit-command rule

Operational or GitHub writes must not be inferred from casual language such as:

- next
- continue
- looks good
- finish it
- apply it
- turn it on

The request must name the intended command and identify the repository item, expected commit or checksum, approved targets where applicable, and owner identity.

## Required real-evidence profile

The active profile is `SCENARIO_BASED`.

Minimum verified evidence:

- 20 observed Paper sessions
- 50 completed Paper orders
- 3 represented market regimes
- 3 restart-recovery passes
- 10 duplicate-order checks
- verified `PERSISTENCE_FAILURE`
- verified `WEBSOCKET_DISCONNECT`
- verified `PARTIAL_WRITE`
- verified `DUPLICATE_SIGNAL`
- verified `KILL_SWITCH`
- current Walk-Forward PASS
- current Cost Stress PASS
- current deterministic Monte Carlo PASS
- current Integrity PASS

The profile replaces only a calendar-duration requirement. It does not replace CI, recovery, source coverage, security review, provenance, checksums, or owner approval.

## Evidence acceptance rules

Evidence is accepted only when all applicable conditions hold:

- generated by the current Paper runtime or an explicitly approved operator drill
- linked to the current validation target
- supported schema and event type
- unique event ID
- continuous sequence
- valid provenance and session linkage
- canonical checksum and chain validation
- no manual editing
- no fixture, test, CI, rehearsal, mock, or developer-seed provenance

A completed order must be durably persisted, terminal, non-duplicate, non-rolled-back, and linked to a valid session.

A fault scenario passes only when its required postconditions are independently validated. A generic PASS event or bare error is insufficient.

## Failure and stop conditions

Immediately stop automatic Paper trading and the strategy when any of the following occurs:

- private API or live-order request
- credential exposure
- database corruption or unknown migration
- partial runtime or durable state
- duplicate Paper order
- kill-switch failure
- restart with automatic trading ON
- persistence failure followed by an executable command path
- evidence corruption, sequence gap, or checksum mismatch
- unexpected database or evidence upload
- unresolved Critical or High safety incident

Preserve the database, WAL, SHM, sanitized logs, artifact identity, and checksums. Do not repair or rewrite evidence during triage.

## Current next actions

### Work that Codex can perform

1. Keep branch CI green and investigate any new failure against the latest HEAD.
2. Connect actual Opportunity, Committee, Strategy analytics, and Research sources to the read-only dashboard when the owner explicitly starts that scope.
3. Improve operator tooling only when it produces verifiable, typed, immutable Paper evidence without manual database manipulation.
4. Maintain Paper-only reachability and fail-closed invariants.

### Work that requires an operator or owner

1. Run the Electron application in the intended Windows environment.
2. Collect genuine scenario-based Paper sessions and orders.
3. Execute supported reconnect, recovery, duplicate, kill-switch, persistence, and partial-write drills.
4. Export and verify the evidence bundle.
5. Review current reports, checksums, limitations, and remaining risks.
6. Explicitly decide whether PR #1 may move from Draft to Ready.

## Status report template

Every lifecycle command should report:

- Decision
- Repository
- Branch or PR
- Expected HEAD
- Actual HEAD
- CI run and tested SHA
- CI status and conclusion
- Paper-only boundary
- Private API detected
- Live-order path detected
- User DB modified or uploaded
- Evidence modified or uploaded
- GitHub writes made
- Current lifecycle state
- Confirmed blockers
- Next owner action
- Next operator action

Use `not verified`, `not evaluated`, `not provided`, or `not applicable` instead of guessing.
