# Connected Evidence Graph Provenance (2026-10-12)

## Source and attribution boundary

Owner-supplied URL: https://polywasp.com/

Public search also surfaced https://purplewasp.com/, whose public description presents a connected Governance, Risk & Compliance (GRC) platform. The identity relationship between these domains has not been verified. Therefore this change does not attribute PurpleWASP's features to polywasp.com and does not copy vendor code.

The reusable design pattern is generic: connect claims to sources, controls, owners, evidence, decisions and downstream outcomes; preserve evidence lifecycle and traceability rather than relying on disconnected status labels.

## Existing NUSA implementation reused

NUSA already has:
- `packages/contracts/src/evidenceGraph.ts` for graph node/edge and seal contracts;
- `apps/execution/src/evidence-graph-seal.ts` for deterministic graph canonicalization, validation and SHA-256 sealing;
- `packages/storage/src/evidence-graph-seal.ts` and migration `026_evidence_graph_seal_chain.sql` for append-only, hash-chain persistence;
- `tests/evidence-graph-seal-chain.test.js` for chain integrity.

This work extends those contracts; it does not create a second graph store, scheduler, governance engine or source of truth.

## Bounded change

Graph nodes can now optionally carry provenance metadata:
- source type: `CANONICAL`, `EXTERNAL`, or `MODEL_GENERATED`;
- verification state: `UNVERIFIED`, `VERIFIED`, `CONTRADICTED`, `STALE`, `SUPERSEDED`, or `REJECTED`;
- source reference and optional SHA-256 fingerprint;
- observation and validity timestamps;
- verifier evidence ID.

Deterministic sealing enforces:
- external/model-generated claims include source references;
- fingerprints and timestamps are well-formed;
- expired evidence must be explicitly marked `STALE`;
- `VERIFIED` claims point to distinct verifier evidence and have an `INDEPENDENTLY_VERIFIES` graph edge;
- provenance changes change the graph fingerprint;
- legacy nodes without provenance retain the previous canonical fingerprint shape.

The verification state is an assertion attached to evidence, not an authority grant. A graph edge by itself is not proof of verifier independence; independent Audit must inspect the linked verifier evidence and its provenance.

## Safety

No changes are made to risk limits, order permissions, strategy qualification, deployment authorization, or production mutation. Graph seals continue to return `deploymentAllowed=false` and `productionMutationAllowed=false`. AI-generated claims remain non-canonical until independently verified.

## Validation status

This document records the intended contract. Test/CI/Audit/Release statuses must be taken from the exact implementation commit and are not implied by this document.
