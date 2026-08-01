# ADR-0001: AIPOS exists to preserve NUSA continuity across AI systems

- Status: Accepted
- Date: 2026-07-31

## Context

NUSA will be implemented over many sessions and may be worked on by different AI systems. Conversation memory, prompts, proprietary agent formats, and vendor-specific instructions are not durable or portable enough to serve as project state.

## Decision

NUSA stores recovery-critical information in the repository under `.aipos/`.

A compatible AI must be able to inspect the repository, read `.aipos/aipos.yaml`, recover current state, select an explicit work order, implement it, verify the result, update repository state, and stop.

The repository is authoritative. Conversation history may provide convenience, but it must never be required to continue development.

## Consequences

- AIPOS metadata changes alongside implementation changes.
- Work that changes project direction must record a decision.
- Work that spans sessions must have a work order and state entry.
- Vendor-specific instruction files may point to `.aipos/`, but cannot replace it.
- AIPOS is not currently a standalone product; it is NUSA's cross-AI development contract.
