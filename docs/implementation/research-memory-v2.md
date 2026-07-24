# Research Memory v2

Research Memory v2 defines an immutable, deterministic contract for the complete research path:

`QUESTION -> HYPOTHESIS -> EXPERIMENT -> EVIDENCE -> DECISION -> OUTCOME -> LESSON`

## Guarantees

- append-only record semantics
- deterministic SHA-256 content identity
- immutable nested payloads and parent links
- unique record IDs
- no self references
- no missing parents
- no cross-research parent links
- no parent newer than its child
- explicit supporting, rejecting, or neutral evidence
- replayable chronological timeline

The module does not trade, allocate capital, promote a strategy, or mutate Governance state. It is a storage-neutral contract intended to be persisted by the existing Research Memory repository layer.
