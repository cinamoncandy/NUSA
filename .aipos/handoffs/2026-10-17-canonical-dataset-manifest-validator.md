# Handoff — #2743 Canonical Dataset Manifest binding (WO-RESEARCH-20261017-CANONICAL-DATASET-MANIFEST)

- **Date:** 2026-10-17
- **Pull request:** #2743 (`feat/fix` scope: bind cloud research to canonical dataset manifests)
- **Branch:** `codex/research-precommit-main`
- **Base protected main:** `a4661cc20c47dd3968c3a3575369262c657e3bc1` (merged into the branch)
- **Head SHA:** deliberately **not** self-recorded in AIPOS — a static file claiming its own future
  commit's SHA/CI result is the self-reference loop §10 forbids. Read it from
  `git log -1 --format=%H` on this branch and from the exact-head CI run on GitHub.
- **Verified immutable SHAs:** protected main `a4661cc20c47dd3968c3a3575369262c657e3bc1`;
  main-merge commit `a625a551e07a0369540a94e3507563ea97ada7a7`.
- **Authority held by the author:** `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY`
- **This handoff grants no authority.** Independent Audit and Release authorization remain mandatory.

## 1. Why this work exists

PR #2743 introduced a canonical-dataset guard in `apps/cloud/src/researchExperimentRunner.ts` that
verifies, before an experiment runs, that the candles it will consume are the fingerprinted dataset
the manifest describes:

- `spec.datasetId` must exist and read back from the manifest store
- `manifest.datasetId / market / interval` must bind to the experiment's own parameters
- the experiment's `endCloseMs` must fall inside the manifest time range
- `ports.candles.read(...)` must return exactly `manifest.candleCount` candles, each with an
  explicit volume, and the recomputed `contentSha256` + `datasetId` must equal the manifest's

That guard is correct and is **not** modified by this continuation.

## 2. The defect this continuation fixes

With the manifest binding active, **every longer-bar (60m / 240m) experiment was structurally
skipped** with `SKIPPED_DATASET_MANIFEST_VOLUME_MISSING`, while the 1m orchestrator completed
normally.

Empirically reproduced (11 days of 1m candles, `NUSA_RESEARCH_INTERVAL_MINUTES=1,60`,
daily budget 10):

| orchestrator | sessionsStarted | experimentTicks counts | statusProjection |
|---|---|---|---|
| 1m | 10 | `{COMPLETED: 10, ...}` | `experimentCount: 2` … |
| 60m | 10 | `{SKIPPED: 10, SKIPPED_DATASET_MANIFEST_VOLUME_MISSING: 10}` | `experimentCount: 0` → assert fails |

**Root cause:** `apps/cloud/src/researchCandleAggregation.ts` `AggregatedResearchCandleSource.flush()`
built longer bars with **no `volume` field at all**, so `candle.volume == null` was always true for
aggregated bars. For 1m, `ratio === 1` short-circuits to the raw store (`researchCandleAggregation.ts:30`),
which does carry volume — which is exactly why only longer bars skipped. The guard and the port were
mutually unsatisfiable by design; nothing in the repo could ever have passed it for a longer bar.

**Fix:** aggregated longer-bar candles now carry **real summed traded volume** when every 1m
constituent has one, and **omit the field entirely (fail closed)** when any constituent lacks it.
Nothing is fabricated: a volume-less source still produces a volume-less bar, so the guard still
refuses it.

## 3. Please scrutinise these three points

1. **`researchCandleAggregation.ts` volume aggregation (the fix).** Confirm that summing constituent
   volumes and dropping the field when any constituent is volume-less is a strengthening and not a
   back door around `DATASET_MANIFEST_VOLUME_MISSING`. The runner's guard line is byte-identical to
   before.
2. **`apps/cloud/src/closedCandleAggregator.ts` mixed-provenance guard.** The in-flight work changed
   the guard from `sources || sourceFingerprints || evidenceFingerprints > 1 → throw` to
   `sources || sourceFingerprints > 1 → throw`, and dropped `evidenceFingerprintsSha256` from the
   returned aggregate. Rationale: a canonical dataset materialized from several evidence receipts
   legitimately carries per-observation evidence fingerprints, while **data-source** identity must stay
   uniform. Note the baseline: current protected main carries **no** such guard in this function at
   all (verified by `git grep evidenceFingerprints origin/main` → 0 hits), so the state after this PR
   is stricter than main. Still, this is the one intentional guard-shape change — treat it as in
   scope for your judgement, not as settled.
3. **The test fixture change** in `tests/research-experiment-composition.test.js` (materializes the
   60m manifest). Confirm it completes the fixture rather than weakening an assertion: the assertion
   `hourly.experimentCount >= 1` is unchanged, and no assertion was deleted or loosened.

## 4. Measured validation (real exit codes, not claims)

| gate | result |
|---|---|
| `tsc -p tsconfig.json` (strict build) | PASS (0) |
| `pnpm run typecheck` (root + mobile) | PASS (0) |
| `pnpm run validate:full` | PASS (0), `"failures": []` |
| `pnpm run aipos:yaml` / `aipos:provenance` / `aipos:index` | PASS (0) |
| `pnpm run security:gate` | PASS (0), `unmitigated: []`, `secrets: 0` |
| `pnpm run lint` | PASS (0), 0 errors / 24 pre-existing warnings; mobile lint PASS 204 files |
| `git diff --check` | CLEAN (0) |
| focused test `tests/research-experiment-composition.test.js` | PASS 13/13 (was FAIL) |
| isolated suite (127 files: research, candle, manifest, period, producer, reader, rollover, recovery, restart, replay, disposition) | **126/127** |
| exact-head CI | **PENDING** (verify on GitHub against the pushed head) |
| independent review / audit / release | **PENDING** |

**The single suite failure** is `tests/release-api-read-recovery.test.js` with
`AssertionError ifError got unwanted exception: spawnSync bash ENOENT`. bash is absent on this local
Windows host and that test spawns bash. It does not touch any file changed here, and CI executes it
on `ubuntu-latest` where bash exists. Classified **ENVIRONMENTAL**, not a regression, and not fixed
by relaxing anything.

## 5. Chain position and what is deliberately NOT claimed

- PR #2743 remains the canonical owner of
  `Learning Cycle N → Dataset Snapshot → Research N+1 Precommit → Experiment`. No second research
  engine, store, scheduler or control plane is introduced.
- PR #2742 is **already merged** (`a4661cc20…`); its storage disposition contract and the new
  `persistedPaperPendingDisposition.test.ts` are present in this branch after the merge and both pass.
  The earlier claim that "the reader still rejects schemaVersion=2" is **stale** — the cloud reader
  calls `SqlitePersistedPaperPeriodStore.listPending()`, which already filters terminal dispositions,
  so a schemaVersion=2 terminal row is never handed to the reader.
- `markPendingIneligible` still has **zero production callers**. No runtime disposition, no successor
  period, no Performance, no Durable Feedback, no Learning Cycle, no Candidate N+1 is claimed.
- Status flags unchanged: `VERIFIED=false`, `PERFORMANCE_IMPROVEMENT=UNPROVEN`,
  `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`.
- Historical INCOMPLETE periods and their bytes are untouched. No live activation, real-money
  mutation, withdrawal, or Risk/Governance/Release bypass occurred anywhere in this work.

## 6. Expected next steps (all outside this author's authority)

1. Push, then verify **exact-head CI** on GitHub for the head recorded in the evidence file.
2. Fresh **non-author validator review** (§12) — P0=0/P1=0 required before Ready.
3. **Independent Audit**, then **Release authorization**, then protected merge (§13).
4. After merge: exact-main deploy with runtime SHA == main SHA, then runtime evidence.
