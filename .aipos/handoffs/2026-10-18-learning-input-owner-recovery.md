# Learning input owner recovery

Canonical PR: #2792; inspected remote head c9b6256a196e2b8e296101d3c1dcf37826db7d70; base 5b347b4b73b88f720c1452270e6ad6bfd61eca3a. PR remains OPEN/Draft.

The downstream LearningChainCycle interface is a caller-supplied contract, not proof of canonical policy or temporal ownership. Do not promote its test fixtures into production authority.

Current local change rejects missing mandatory policy identities and adds sync/async adversarial authority tests. Typecheck, build and 22 focused tests passed. These uncommitted changes have no CI/Audit approval.

FIRST_BROKEN_TRANSITION: canonical owner values and evidence -> production LearningInputSet -> existing LearningInputSetLedger -> decision identity.

Next: trace policy publication, PAPER close boundary and meta-OOS assignment producers; record field/source/version/restart semantics before production wiring. Missing owners remain BLOCKED_CANONICAL_OWNER_UNRESOLVED. Do not use Date.now or maximum evidence time as invented cutoff. Preserve strict recordedAt < cutoff.

PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false; aiAuthority=ZERO_AUTHORITY. LEARNING_LOOP_VERIFIED=false; PERFORMANCE_IMPROVEMENT=UNPROVEN. No Audit, release, merge or runtime acceptance claimed.
