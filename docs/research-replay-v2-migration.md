# Research replay persistence v2 — migration and rollback

Status: **code/CI validation only** under work order #1822. This document does not authorize Oracle-host mutation.

## Problem being removed

The legacy `FileResearchRunReplaySnapshotStore.save()` preserves immutable historical bytes by scanning the complete archive and then copying the complete archive to a temporary file before appending one snapshot. At the Oracle production size observed in #1543 (~555 MB / 35,934 records), that makes each Research save scale with total retained history.

## v2 persistence contract

`FileResearchRunReplaySnapshotObjectStoreV2` stores each committed snapshot in an immutable record object. Every record contains:

- a monotonic ordinal,
- the previous committed record SHA-256,
- the unchanged v1 `ResearchRunReplaySnapshot`, including its existing `snapshotSha256`, and
- a record SHA-256 over the record payload.

`HEAD.json` is the only mutable publication point. It is written to a temporary file, fsynced, and atomically renamed after the new immutable record is durable. A record object that exists without a matching HEAD update is uncommitted and is not returned by the store. The fingerprint hardlink index is published only after HEAD, so an interruption before HEAD cannot expose an uncommitted snapshot through normal lookup.

The committed order is the SHA-256 back-chain rooted at `HEAD.chainHeadSha256`; it does not depend on filesystem enumeration order. Full chain verification rejects missing records, ordinal gaps, duplicate replay identities, hash mismatch, corrupted snapshots, or a non-zero chain root.

Steady-state `save()` validates the new snapshot, validates HEAD and the current chain head, performs an O(1) fingerprint-path lookup, writes one new immutable record, replaces the small HEAD, and publishes one fingerprint hardlink. It does **not** scan, semantically replay, copy, rewrite, or sort the historical archive.

## Explicit legacy migration

Migration is deliberately not automatic. `migrateLegacyResearchRunReplayArchiveToV2(legacyFile, v2Root)`:

1. never mutates the v1 legacy archive;
2. streams the legacy JSON archive one snapshot at a time with checksum/provenance validation;
3. writes the v2 representation into deterministic sibling staging directory `<v2Root>.migration-v2`;
4. on restart, verifies the already committed v2 prefix against the same legacy ordinal/fingerprint/snapshot hashes and resumes at the first missing record;
5. fully verifies the finished v2 chain and semantic replay;
6. writes a checksum-bound `MIGRATION.json` containing legacy size/mtime, record count and deterministic logical replay digest; and
7. atomically renames the completed staging directory to `v2Root`.

If the final v2 root already exists, a repeated migration is idempotent: it validates the migration marker/source identity and returns without rewriting the committed chain.

## Required pre-rollout evidence

Before any Oracle migration, attach to #1822:

- focused adversarial test results,
- full exact-head CI/Audit results,
- benchmark output from `node scripts/benchmark-research-replay-v2.js`,
- a large-fixture or copied-production-shape benchmark showing before/after save latency and filesystem I/O,
- legacy-v2 ordered fingerprint/snapshot-hash equivalence,
- interrupted-migration resume evidence,
- second-run idempotence evidence, and
- a read-only verification of the migrated v2 tree.

For larger synthetic benchmarks set `NUSA_REPLAY_BENCH_SNAPSHOTS`; the benchmark prints measured v1/v2 duration, read bytes, copied bytes and write bytes. Timing is observational only; no performance claim should be made from a single noisy runner.

## Rollback / recovery

The v1 archive remains unchanged throughout migration and is the rollback source of truth until an explicit later rollout retires it. If v2 validation fails before cutover, do not repair or delete v1 evidence; discard or quarantine only the uncommitted/staging v2 tree and continue using the legacy reader.

After any future cutover, rollback is configuration/reader selection back to the untouched v1 archive. Do not synthesize missing snapshots, compact the legacy archive, or rewrite corrupted committed v2 objects. Any checksum, chain, migration-marker, ordinal, or fingerprint mismatch is fail-closed and requires operator review.

## Authority boundary

This work changes Research evidence persistence only. It does not introduce or expand broker credentials, execution paths, strategy thresholds, LIVE activation, or production mutation authority. Existing invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
