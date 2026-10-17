# CORE -> AIPOS Command Routing Handoff

## Intent

Make AIPOS the durable command/state/handoff layer for role-based execution across interchangeable providers (Codex, Claude Code, MiMo, or another capable model).

## What changed

- Added `.aipos/command-routing.yaml` with fixed role ownership and provider-fungible assignment.
- Added `.aipos/commands/2026-10-17-core-directives.yaml` with current CORE directives.
- Registered both paths and command selection/update steps in `.aipos/aipos.yaml`.

## Current priority

P0 remains the actual PAPER learning closed loop. P1 is independent Data/Evidence continuity and Validation/Release/Runtime. DEV and Scout remain available but must not preempt unresolved P0 work.

## Safety

No LIVE or real-money authority is granted. Existing `.aipos/current-mission.yaml` serialization remains authoritative. PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY remain unchanged.

## Review focus

1. Does this duplicate an existing AIPOS queue/owner mechanism?
2. Are role boundaries compatible with existing CORE/EVOLVE/AUTOPILOT/VALIDATOR contracts?
3. Does command selection preserve existing ready-work-order rules?
4. Can a provider switch occur without hidden state or prior chat history?
5. Is non-author validation separation explicit enough?

This proposal must not merge merely because it records CORE intent; normal validation/release gates still apply.
