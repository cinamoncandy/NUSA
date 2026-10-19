# Handoff — applied-migration 026 restoration (WO-OPS-20261017-MIGRATION-026-CHECKSUM-REPAIR)

- **Date:** 2026-10-17
- **Why a new branch:** PR #2743 merged at `2026-10-17T04:19:31Z` and is closed, so the repair is a
  new increment rather than a continuation.
- **Branch:** `codex/fix-026-migration-checksum-20261017`
- **Base protected main:** `1524c15fb16b96e8d06b1c304ba12fae888c01dc` (the merge commit that carries
  the defect; this branch is cut directly from it and does not merge it in, because it already *is*
  main)
- **Head SHA:** deliberately **not** self-recorded in AIPOS — a static file claiming its own future
  commit's SHA/CI result is the self-reference loop §10 forbids. Read it from
  `git log -1 --format=%H` and from the exact-head CI run on GitHub.
- **Verified immutable SHAs:** protected main `1524c15fb16b96e8d06b1c304ba12fae888c01dc`;
  defective merge commit `1524c15f`; last healthy release `a4661cc20c47dd3968c3a3575369262c657e3bc1`.
- **Authority held by the author:** `PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / aiAuthority=ZERO_AUTHORITY`
- **This handoff grants no authority.** Independent Audit and Release authorization remain mandatory.

## 1. What actually happened, in order

| Time (UTC) | Event |
|---|---|
| 04:18:10 | `gh pr ready 2743` → `ready_for_review` |
| 04:18:19 | automation reacted with a `nusa_autopilot_audit` dispatch → run #2035 |
| 04:19:31 | **Audit job success → Release success → PR #2743 merged**, main became `1524c15f` |
| 04:19:49 | my own re-dispatch → run #2036, audit success, release `skipped` (already merged) |
| 04:19:34+ | exact-main CI on `1524c15f` → success; Cloudflare Deploy / Promote / Runtime Proof → success |
| 04:29:41 | deployment convergence receipt → **`CONVERGENCE_INCOMPLETE`**, Oracle component the single empty `run_id` |
| 04:32:51 | Oracle PAPER Release dispatched for `1524c15f` |
| 04:53:28 | activation **FAILED**: `database migration checksum mismatch: 026_research_closed_candles` |

Two things are worth carrying forward:

1. **The merged content was exactly what §9 validated.** `tree(f312190c) == tree(1524c15f) ==
   9c1ca009f03e560e51a98e0d12e17e5068e7ac32`. The defect was not introduced by the merge; it was in
   the tree the whole time, and no suite in this repository is structurally capable of seeing it.
2. **Fail-closed worked exactly as designed.** The host switched the symlink, the runtime refused to
   boot, and the release step reverted `current` to `a4661cc2`. The Oracle host never ran a partial
   schema, never lost its previous healthy release, and the authority quadruple stayed intact.

## 2. The defect

`11cf0b4d feat: bind cloud research to canonical dataset manifests`
(2026-10-17T00:30:14+09:00) edited an **already-applied** inline migration in
`packages/storage/src/index.ts`:

```diff
   close REAL NOT NULL CHECK (close > 0),
+  volume REAL CHECK (volume IS NULL OR volume >= 0),
   checksum TEXT NOT NULL,
```

`schema_migrations` holds a checksum per applied migration. Once that SQL changed, every deployed
database disagreed with the code and `migrationRunner` refused to construct — a hard fail-closed
refusal, not a warning.

**Authorship, stated plainly:** this came from the pre-existing `codex/research-precommit-main`
branch work that this session resumed. Commit `f312190c` (nine files) did **not** touch
`packages/storage/src/index.ts`. But this session drove that branch through Audit and Release into
protected main, so the merge responsibility is recorded here rather than assigned away.

## 3. Why no validation could catch it

The guard only engages against a database that **already recorded** migration 026. Local tests and
CI both build fresh databases, where every migration applies cleanly for the first time, so:

- `storage-migrations.test.js` passes — it asserts the applied list on a new database
- `security:gate` passes — nothing about this is a secret or a threshold
- exact-head CI passes — same fresh-database reason
- **only the Oracle release step runs against the real host database**

That is the precise reason §14 post-merge deploy verification exists, and the reason the receipt
workflow reported `CONVERGENCE_INCOMPLETE` rather than a false green.

## 4. The checksum contract (read this before touching migrations)

`packages/storage/src/migrationRunner.ts` computes:

```ts
createHash("sha256").update(`${migration.id}\\n${migration.sql}`, "utf8").digest("hex")
```

That `\\n` is a **literal backslash followed by `n`**, not a newline. It is almost certainly not
what the original author meant, but it is baked into every checksum already written to every
deployed database. **Never correct it** — doing so would desynchronize every live database
simultaneously and reproduce this incident across all of history at once.

Values relevant to 026:

| Value | SHA | Meaning |
|---|---|---|
| deployed / historical | `fd3ed8fe280f054d7f62bf8e1262f3cb37be2d0c2d56b0484016fc4fbf976cb4` | what production recorded; derived two independent ways |
| mutated on main | `1e40cc934186f6bec64a60ed823b4c31d3e1dee59811e9ac85488016c7d2a5bc` | `1524c15f`, the value that fails |

The deployed value was derived two ways that agree: hashing the 026 SQL extracted from commit
`a4661cc20` (its git blob is the LF form production executed), and reading back what the current
runtime writes into `schema_migrations` on a freshly created database.

## 5. Please scrutinise these four points

1. **The restoration must be byte-identical, not merely equivalent.** Confirm
   `git diff a4661cc20 -- packages/storage/src/index.ts` shows no hunk inside the 026 block — only
   the appended 031 entry. Whitespace, comment, or line-ending drift inside 026 reopens the incident.
2. **`ALTER TABLE ... ADD COLUMN ... CHECK` must stay valid.** Verified against the runtime SQLite
   that `ADD COLUMN` accepts a CHECK constraint, rejects negative values, and accepts NULL. The NULL
   acceptance is load-bearing: rows written before the column existed must keep `NULL` volume.
3. **The guard must stay portable.** `tests/migration-026-immutability.test.js` normalizes CRLF→LF
   because git stores LF while `core.autocrlf` can present CRLF on Windows checkouts. The runtime
   records the LF form on every platform (confirmed by probing the actual value it writes).
4. **The `\\n` separator must not be "fixed."** See §4. A well-meaning cleanup here is a
   repository-wide outage.

The new guard is proven non-vacuous: it fails against `1524c15f` and passes against this fix.

## 6. What is deliberately NOT changed

- No `schema_migrations` record is edited or deleted anywhere. Path B (registering the old checksum
  in `LEGACY_DEPLOYED_MIGRATION_CHECKSUMS`) was available and **not** taken, because it leaves
  026's recorded checksum describing SQL that no longer exists in the tree.
- The `volume` column definition is unchanged from what the merged branch intended; only its
  delivery mechanism changes from an in-place edit of applied history to an additive migration.
- No table is recreated and no row is rewritten.
- The checksum-mismatch guard is not relaxed in any way — it fired correctly, and it stays.
- `.aipos/state.yaml` is untouched: `in_progress` must remain exactly one entry (`WO-0051`, the
  terminal human/environment gate), so this work order is recorded as a file but not registered there.

## 7. Remaining chain

1. Push and confirm exact-head CI on this head (do not pre-claim it).
2. Fresh **non-author** VALIDATOR review, `P0=0`/`P1=0` before Ready.
3. Independent Audit → Release authorization → protected merge.
4. After merge: dispatch the Oracle PAPER Release for the new protected main, then require the
   deployment convergence receipt to report **`CONVERGED`** with the Oracle component no longer an
   empty `run_id`. The last receipt for `1524c15f` was `CONVERGENCE_INCOMPLETE` with 7 of 8
   components present.
5. Until the full chain and replay are verified: `VERIFIED=false`,
   `PERFORMANCE_IMPROVEMENT=UNPROVEN`, `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`.
