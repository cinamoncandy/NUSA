# NUSA Complexity Reduction Proposal

**Status**: Proposal only — requires owner review and AIPOS work order

**Implementation status (annotated, code unchanged by this note)**:
- §1 (validation consolidation): PARTIAL — `scripts/validate-tiers.js` groups the
  ~40 validators into safety/architecture/aipos tiers for invocation
  (`docs/VALIDATOR_REGISTRY.md`); per-file gates are unchanged. Full file-level
  consolidation still needs the work order below (CI calls gates by name).
- §2 (lightweight recovery) + §3 (evidence scope) + §5 (human-only physical
  acceptance): IMPLEMENTED in `AGENTS.md` (lightweight path,
  `authority_impact: none`, evidence scope, `HUMAN_ENVIRONMENT_ONLY`).
- §4 (docs surface reduction): OPEN.  
**Goal**: Reduce maintenance burden while **preserving all safety invariants**

## Problem Statement

NUSA has accumulated a very high process density:
- Large number of validation scripts
- Strict AIPOS recovery protocol
- Extensive evidence and audit requirements
- Multiple parallel surfaces (desktop / cloud / mobile)

This is excellent for safety and multi-AI continuity, but creates high cognitive and operational cost for a primarily single-owner project.

## Non-negotiable Constraints

Any reduction **must not**:
- Weaken fail-closed behavior
- Give AI any order/transfer/LIVE authority
- Remove risk veto capability
- Allow production mutation by default
- Break deterministic recovery or evidence requirements for safety-critical paths
- Violate the current AIPOS handoff contract without explicit replacement

## Recommended Reductions (Safe)

### 1. Validation Script Consolidation (High value, low risk)

Current state has many overlapping scripts (`architecture:*`, `safety:*`, `aipos:*`, `restricted-live:*`, etc.).

**Proposal**:
- Keep a single entrypoint: `pnpm validate`
- Internally run a prioritized subset of checks
- Move rarely-used deep audits behind `pnpm validate:full` or `pnpm validate:audit`
- Preserve `architecture:truth` and `safety:architecture` as hard gates

Expected benefit: faster local feedback loop without losing critical gates.

### 2. AIPOS Recovery Lightweight Mode (Medium value)

**Proposal**:
- Keep full recovery protocol for safety-critical or multi-AI handoff work
- Add a documented “fast path” for pure UI / docs / non-authority changes
- Explicitly mark work orders as `authority_impact: none` so agents can skip deep architecture re-validation

This reduces friction for the majority of day-to-day changes.

### 3. Evidence Scope Narrowing

**Proposal**:
- Require full evidence packages only for:
  - Authority boundary changes
  - Risk / execution / accounting changes
  - Recovery / persistence changes
- Allow lighter “change notes” for pure presentation, docs, and non-safety mobile UI

### 4. Documentation Surface Reduction

**Proposal**:
- Keep `README.md`, `nusa.md`, `AGENTS.md`, `.aipos/architecture.md` as canonical
- Move historical audit docs older than a defined window into `docs/archive/`
- Generate a short “Current State” summary from `.aipos/state.yaml` instead of maintaining parallel status docs

### 5. Mobile Physical Acceptance Clarification

**Proposal**:
- Explicitly document that physical Android acceptance is a **human-only gate**
- Do not block repository CI or other work streams on it
- Keep the current `HUMAN_ENVIRONMENT_ONLY_PENDING` status visible but non-blocking

## Explicitly Out of Scope (Do Not Reduce)

- Risk Governor
- Kill switch
- Fail-closed startup and recovery
- AI zero-authority enforcement
- Paper-only default
- Separation of Paper vs Live mutable state
- Renderer sandbox / preload restrictions

## Suggested Implementation Path

1. Create AIPOS work order: “Complexity reduction — validation consolidation & lightweight recovery path”
2. Implement script consolidation behind feature flags or dual entrypoints
3. Update `AGENTS.md` and `.aipos` recovery protocol with the fast-path rules
4. Run full existing validation suite to prove no safety regression
5. Update state.yaml and handoff evidence

## Success Metrics

- Median time for a non-authority change (docs/UI) decreases
- All existing safety gates still pass
- New contributors / AI agents can still recover full context from the repository alone
- No increase in “silent” authority or safety drift

---

This proposal deliberately stays conservative.  
More aggressive simplification is possible later, but only after the current safety posture has been stable under real usage.
