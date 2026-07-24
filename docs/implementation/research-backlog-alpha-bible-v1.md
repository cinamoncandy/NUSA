# Research Backlog and Alpha Bible v1

## Research Backlog

`researchBacklog.ts` provides an immutable research queue contract.

Each item records priority, status, owner, question, falsifiable hypothesis, linked Alpha IDs, research dependencies, evidence and experiment counts, and chronology. Snapshot construction rejects duplicate IDs, missing dependencies, dependency cycles, future records, and content-hash mismatches. Ranking is deterministic: priority, workflow status, creation time, then ID.

The backlog does not run experiments, promote strategies, allocate capital, or submit orders.

## Alpha Bible Generator

`alphaBibleGenerator.ts` projects an `AlphaEvidenceRegistrySnapshot` into a deterministic, read-only knowledge document. It selects the latest registered version of each Alpha while preserving version history, groups supporting, rejecting, and neutral evidence, and emits both structured entries and Markdown.

The generated document records its source Registry snapshot hash and has its own SHA-256 content hash. It cannot mutate Registry state, alter Alpha lifecycle, approve evidence, allocate capital, or enable LIVE trading.

## Safety boundary

Both modules remain PAPER/DRY_RUN research infrastructure. Human and Governance approval remain mandatory for lifecycle or capital changes.
