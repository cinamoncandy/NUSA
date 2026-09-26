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

`HEAD.json` is the only mutable publication point. It is written to a temporary file, fsynced, and atomically renamed after the new immutable record is durable. A record object that exists without a matching HEAD update is uncommitted and is not returned by the store.

Two derived hardlink indexes are published after HEAD:

- `by-fingerprint/<fingerprint>.json` gives O(1) lookup and is provenance-bound back to the replay fingerprint;
- `commits/<ordinal>.json` binds each published ordinal to its immutable record and makes a byte-for-byte rollback to an older, otherwise checksum-valid HEAD detectable in O(1).

If the process dies after atomic HEAD publication but before either derived hardlink is published, a restart may reconstruct only the missing marker for the checksum-bound committed chain head. A pre-HEAD orphan record has neither a committed HEAD nor an ordinal marker and remains uncommitted. If HEAD is restored to an older count while the next ordinal marker already exists, the store fails closed as stale rather than silently accepting the rollback.

The ordinal-marker guard is corruption/stale-state detection for the repository persistence contract. It is **not** a cryptographic anti-rollback mechanism against a fully privileged filesystem administrator who can deliberately rewrite or delete every file in the store.

The committed order is the SHA-256 back-chain rooted at `HEAD.chainHeadSha256`; it does not depend on filesystem enumeration order. Full chain verification rejects missing records, ordinal gaps, duplicate replay identities, hash mismatch, corrupted snapshots, or a non-zero chain root.

Steady-state `save()` validates the new snapshot, validates HEAD and the current chain head, performs O(1) fingerprint/ordinal marker checks, writes one new immutable record, replaces the small HEAD, and publishes the two derived hardlinks. It does **not** scan, semantically replay, copy, rewrite, or sort the historical archive.

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

- focused adversarial test results, including corrupt/truncated record, checksum-invalid HEAD, byte-for-byte valid stale-HEAD rollback, post-HEAD marker repair, duplicate identity, ambiguous latest, and interrupted migration cases;
- full exact-head CI/Audit results;
- benchmark output from `node scripts/benchmark-research-replay-v2.js`;
- a large-fixture or copied-production-shape benchmark showing before/after save latency and filesystem I/O;
- legacy-v2 ordered fingerprint/snapshot-hash equivalence;
- interrupted-migration resume evidence;
- second-run idempotence evidence; and
- a read-only verification of the migrated v2 tree.

For larger synthetic benchmarks set `NUSA_REPLAY_BENCH_SNAPSHOTS`. The benchmark reports API-level explicit read/write payload bytes, `copyFileSync` source bytes, an estimated data-movement total, and wall-clock duration. The byte counters are not physical-disk-sector measurements, and timing is observational only; no production latency claim should be made from one noisy hosted runner or a synthetic fixture.

## Rollback / recovery

The v1 archive remains unchanged throughout migration and is the rollback source of truth until an explicit later rollout retires it. If v2 validation fails before cutover, do not repair or delete v1 evidence; discard or quarantine only the uncommitted/staging v2 tree and continue using the legacy reader.

After any future cutover, rollback is configuration/reader selection back to the untouched v1 archive. Do not synthesize missing snapshots, compact the legacy archive, or rewrite corrupted committed v2 objects. Any checksum, chain, commit-marker, stale-HEAD, migration-marker, ordinal, or fingerprint mismatch is fail-closed and requires operator review.

A missing current ordinal marker or fingerprint link may be reconstructed only when it is derivable from the checksum-valid committed HEAD and its immutable chain-head record. A conflicting or future marker is not repairable automatically.

## Authority boundary

This work changes Research evidence persistence only. It does not introduce or expand broker credentials, execution paths, strategy thresholds, LIVE activation, or production mutation authority. Existing invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
