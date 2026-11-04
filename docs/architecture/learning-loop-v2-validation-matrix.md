# Learning Loop v2 — Validation Matrix

**Status:** CONFIRMED

Each design decision maps to a deterministic check that produces evidence. A row is satisfied only
by produced evidence, never by an assertion in prose.

---

## 1. Design decision → verification

| Ref | Decision | Verification | Evidence form |
| --- | --- | --- | --- |
| D1 | Two lanes converge into one decision; neither has authority | A decision record names both lane digests; a record carrying only one lane's digest, or carrying deploy/exec authority, is rejected | rejected-record count |
| D2 | Learning is not gated on deployability | A closed window whose every candidate was REJECTED still produces a decision receipt | receipt with `candidateCount > 0 && qualifiedCount == 0` |
| D3 | Decision is a receipt, not a mutation | Assert the decision path performs zero writes to any allowlisted surface | write-count = 0 on the proposal path |
| D4 | Allowlist-only mutable surface | A decision addressing any surface outside S1 is rejected | rejected-record count, per surface |
| D5 | Every update is bounded | A proposal exceeding the trust region is recorded `REJECTED` with the bound stated — never silently clamped and reported as success | rejected-record count + stated bound |
| D6 | Meta-out-of-sample over cycles | A guidance that passes meta-validation but fails meta-holdout is `REJECTED`, and cannot reach `APPLIED` | partition-tagged decision records |
| D7 | Diversity / exploration enforced | Repeated identical surface selection is prevented; exhaustion is reported as exhaustion | exhaustion state |

## 2. Safety invariants → verification

| Invariant | Verification | Evidence form |
| --- | --- | --- |
| `PAPER_ONLY` | No LIVE capability is granted anywhere on the decision path | existing authority checks, unchanged |
| `liveAuthority = NONE` | Decision records carry no deploy authority | authority validation throws (`closedLearningLoopCoordinator.ts:136`) |
| `productionMutationAllowed = false` | DB-level constraint retained | `startup_gate_audits.production_mutation_allowed CHECK(=0)` (`packages/storage/src/recovery-evidence.ts:7`) |
| `aiAuthority = ZERO_AUTHORITY` | Artifact authority check retained | `qualifiedPaperChallengerArtifactStore.ts:33` |
| Threshold relaxation banned | No runtime-reachable threshold mutation exists | exhaustive search returned NOT FOUND, **before and after** each step |
| Synthetic evidence banned | Lane A hash chains and Lane B checksums reject fabricated records | integrity-check throws |
| Historical rewrite banned | All learning ledgers append-only; strict replay throws on tamper | `closedLearningEvolutionLedgerRepository.ts:166` |
| Failed-trial deletion banned | Failures are appended and deduplicated, never removed | `closedLearningEvolutionLedgerRepository.ts:153-164` |
| Denominator manipulation banned | Full denominator already durable | `research_factory_decision_history` |
| Duplicate scheduler/engine/store/control plane | Single composition root, single lease | `closedLearningProductionRuntime.ts:79-97,140-147` |
| Blind restart / unlimited retry | Bounded resume, same-day restriction | `MAX_CYCLE_RESUME_ATTEMPTS = 5`; `closedLearningRolloverScheduler.ts:179-188` |
| Self-review / self-approval / AI direct merge | Governance actor restriction retained | `paperChallengerDeploymentRuntime.ts:77-85` |

## 3. Identity, PIT, and replay → verification

| Property | Verification | Evidence form |
| --- | --- | --- |
| Exactly-once cycle | Re-submitting identical evidence yields `REPLAYED` and writes nothing new | cycle result = `REPLAYED` |
| Identity conflict detection | Same cycle id, different content → throws | thrown identity conflict |
| PIT cutoff | A record observed at or after `cutoffAt` is not admissible | rejected admissibility count |
| Provenance survives retention | A decision whose reference was pruned is reported unverifiable, never re-derived | unverifiable-decision count = 0 |
| Silent gap detection | A closed window with no decision and no `INSUFFICIENT` record is detectable from durable data alone after restart | gap count = 0 |

## 4. Explicitly NOT evidence of success

Per the work order, none of the following counts as validation, and none may be presented as it:

CI green · merged code · counters · presence of Learning rows · a mocked N→N+1 · synthetic or
baseline periods · a single open listener · an active systemd unit · a single health PASS · an
Audit-only PASS · an increased REJECTED count

**Also not evidence:** any performance claim. `PERFORMANCE_IMPROVEMENT` remains `UNPROVEN` and
`LEARNING_LOOP_VERIFIED` remains `false` until a genuine closed-learning cycle completes through
research N → negative feedback → research N+1 → qualified challenger → realized PAPER → complete cost
→ performance feedback → paired validation → restart/replay, with real recorded evidence at each
step.

## 5. Current baseline (for later comparison — measured, not asserted)

| Metric | Value |
| --- | --- |
| Realized PAPER periods | 31 |
| Canonical fills | 202 |
| Genuine closed-learning cycles | **0** |
| Deployable candidates | **0** |
| Candidate decisions | 276 REJECTED / 8 INSUFFICIENT / 0 DEPLOYABLE |
| Mean net / excess | ≈ −16 bp / ≈ +21 bp |
| `holdoutPass` | `false` |

These are the observed values on protected main. They are reported as the starting condition, not as
a result, and are not to be quoted as a performance measurement.
