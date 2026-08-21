# ADR-0015: Desktop module boundary remediation (proposal)

## Status

PARTIALLY IMPLEMENTED. Items 1 (folder reorganization) and 2 (main.ts IPC
handler extraction) landed; items 3-5 remain PROPOSAL. Recorded per `.aipos/architecture-governance.json`
lifecycle (`PROPOSAL -> IMPACT_ANALYSIS -> ARCHITECTURE_REVIEW -> MIGRATION_PLAN
-> APPROVAL -> STAGED_ADOPTION -> VERIFICATION`) because every item below
changes file-level interfaces that `.aipos/functional-status.yaml` and
`.aipos/module-map.yaml` track as durable execution-state
(`implementation_paths`), and because `apps/desktop/src/main.ts` and
`shadowOperationalRuntime.ts` sit on the PAPER-trading safety path. AIPOS may
propose architecture changes but must not silently mutate them (`.aipos/architecture.md`
"Architecture-to-AIPOS synchronization"), so this ADR stops at PROPOSAL rather
than executing.

## Context

A structural review of `apps/desktop/src` (see prior commits on this branch,
which already remediated the mechanically-safe portion: byte-identical
desktop/cloud module duplication and cross-app relative imports into
`apps/execution/src`) found five remaining structural issues that require
actual redesign judgment rather than a mechanical file move, so they were not
executed in the same pass:

1. **`apps/desktop/src/main.ts` (~1.6k lines)** mixes the Electron app
   lifecycle, IPC channel registration (45+ `ipcMain.handle`/`.on` calls),
   dependency wiring (composition root), and inline trading/AI/risk
   orchestration in one file. `scripts/validate-architecture-surfaces.js`
   already anchors specific markers (`ipcMain.handle(`,
   `contextBridge.exposeInMainWorld(`) to `apps/desktop/src/main.ts`
   specifically (line 7), so any split must update that surface-governance
   config in the same change, not after.

2. **`apps/desktop/src/domainEventBus.ts`** implements a second,
   bespoke bounded/exactly-once event bus alongside
   `packages/core/src/eventBus.ts`'s `EventBus<Events>`. `.aipos/architecture.md`
   says integrators "must not create a parallel kernel ... or lifecycle
   framework." The two buses were not verified to have equivalent delivery
   semantics; merging them requires confirming `domainEventBus.ts`'s
   exactly-once/bounded guarantees can be expressed on top of
   `packages/core`'s bus (or that the core bus needs those guarantees added)
   before any call site is touched.

3. **`apps/desktop/src` is a single flat directory of 121 files** with no
   domain subfolders (IPC validation, strategy/backtest, AI explainers,
   exchange adapters, evidence/shadow state, and Electron-shell plumbing all
   sit as siblings). A folder reorganization is mechanically safe for the
   TypeScript compiler (relative imports can be rewritten by codemod and
   verified with `tsc --noEmit`), but `.aipos/functional-status.yaml` records
   exact paths as capability evidence (e.g. `apps/desktop/src/paperBroker.ts`,
   `apps/desktop/src/positionSizing.ts`, `apps/desktop/src/upbit*.ts`) and
   `.aipos/module-map.yaml` records `apps/desktop/src` as a module root. Those
   files must be updated in the same change or AIPOS execution-state silently
   goes stale, which `.aipos/architecture.md` explicitly forbids.

4. **`shadowOperationalRuntime.ts` (~1k lines)** combines lifecycle state
   machine, market-data health classification, safety-state tracking, and
   evidence-recovery signaling in one class. Splitting it requires confirming
   which internal state is genuinely independent versus load-bearing shared
   mutable state read across those concerns before extraction, to avoid
   introducing a shadow-runtime correctness regression on the safety path.

5. **`desktopPersistenceStore.ts` (~470 lines)** is a facade over SQLite
   migrations plus four unrelated domains (committee-ledger replay, research-run
   validation, opportunity scheduling, paper-scenario evidence) bundled by
   accident of being persisted rather than by domain.

## Decision (proposed, not yet approved)

Sequence any future work in this order, each as its own reviewed change with
its own AIPOS synchronization:

1. DONE. `apps/desktop/src`'s 102 domain files were moved into 13 subfolders
   (`ipc/ strategy/ paper/ exchange/ risk/ ai/ shadow/ evidence/ cloud/
   control/ persistence/ recovery/ diagnostics/`), 19 Electron-shell files
   stayed at root, and `.aipos/functional-status.yaml`,
   `config/architecture/surfaces.json`, and `config/shadow/governance.json`
   were updated in the same commit. Verified with `tsc --noEmit` (root +
   mobile), a full rebuild, `node --test tests/*.test.js` (3212/3217,
   matching the pre-existing baseline exactly), and every architecture/safety
   validator. See the "reorganize apps/desktop/src into domain subfolders"
   commit on this branch. Two latent test bugs predating this ADR (tests
   asserting content against post-dedup re-export shims instead of the
   canonical `packages/core` source) were found and fixed along the way,
   which is only possible now that `node --test` can actually run in-session
   against the built `dist/` output (Electron's own postinstall fails
   without network access to its binary host, but the test suite does not
   need Electron).
2. DONE. `main.ts`'s 45 `ipcMain.handle(...)` registrations, and their
   inline bodies, moved into 8 `apps/desktop/src/ipc/register*IpcHandlers.ts`
   files (paper/execution, AI, control, kill-switch safety, shadow,
   recovery, app-shell/product, diagnostics), each taking a `RuntimeContext`
   -- a typed live-getter/setter proxy over main.ts's own state
   (`apps/desktop/src/ipc/runtimeContext.ts`) -- so no state was duplicated
   and no handler now reads a stale snapshot. `main.ts` dropped from 1642 to
   1271 lines and now holds only the Electron lifecycle, state ownership,
   and the shared helper functions the handler modules call back into.
   `config/architecture/surfaces.json`'s governed-owner list and 8 test
   files that statically scanned `main.ts` for handler-specific patterns
   were updated in the same commit. Verified with `tsc --noEmit` (root +
   mobile, which would fail on any RuntimeContext property left
   unlisted/mistyped), a full rebuild, `node --test tests/*.test.js`
   (3212/3217, matching the established baseline exactly), and every
   architecture/safety validator (16 governed owners now, up from 8). See
   the "extract main.ts's 45 IPC handlers into 8 domain modules" commit.
   Caveat, recorded here rather than silently: this sandbox cannot launch
   the actual Electron process, so this change is verified by static typing
   and the existing unit/static-scan suite, not an end-to-end run of the
   packaged app.
3. DONE. Compared `DomainEventBus` (as it was then:
   `apps/desktop/src/control/domainEventBus.ts`) against `packages/core/src/eventBus.ts`'s
   `EventBus<Events>`:

   - **Different problems, not competing implementations of the same one.**
     `EventBus` is a generic typed pub/sub: `subscribe`/`publish`/`once`,
     async handlers, no ordering or delivery guarantee beyond
     "await every current subscriber." `DomainEventBus` is a
     single-purpose durable-delivery pipeline for the Shadow evidence chain
     of custody: `publish()` is **synchronous and non-blocking** by
     necessity (the caller is inside a market-tick callback and cannot
     `await`), and it adds bounded-queue backpressure, sequence+hash
     exactly-once dedup, and fail-closed halt-on-overflow/halt-on-write-
     failure semantics that `EventBus` has no concept of at all. Extending
     `EventBus` to grow all of that would not be "adding a missing
     guarantee" to a generic primitive -- it would turn a generic bus into
     this one specialized pipeline wearing a generic name, which is worse
     for every other (hypothetical) consumer of `EventBus`, not better.
   - **No actual overlap in practice.** `DomainEventBus` is used only by
     `shadowEvidenceComposition.ts` and `shadowOperationalRuntime.ts` --
     nowhere else in the app. `packages/core/src/eventBus.ts`'s `EventBus`
     is used only by `packages/core/src/runtime.ts` itself. Neither is
     actually serving as "the" app-wide event system that the other
     duplicates; they are each already scoped to one narrow job. There is
     no call site to migrate.

   Conclusion: `DomainEventBus` is a deliberate, justified exception to
   "must not create a parallel kernel," not an accidental duplicate --
   it solves a durability/backpressure problem `EventBus` was never
   designed for, under a real-time constraint (`publish()` must not block
   a market-tick callback) `EventBus`'s async API cannot satisfy. No merge,
   no call-site migration needed. This paragraph is the recorded
   justification the architecture contract asks for.

   Also done, as a low-risk follow-up now that the exception is justified
   rather than left looking like an accidental near-duplicate: renamed
   `DomainEventBus` -> `ShadowEvidenceBus` (and its
   `DomainEventSink`/`DomainEventHaltReason`/`DomainEventBusDiagnostics`/
   `DomainEventBusOptions`/`DomainEventBusStatus` companions to their
   `ShadowEvidence*` equivalents), and moved the file from
   `apps/desktop/src/control/domainEventBus.ts` to
   `apps/desktop/src/shadow/shadowEvidenceBus.ts` -- it belongs in the
   `shadow/` bucket with its only two call sites
   (`shadowEvidenceComposition.ts`, `shadowOperationalRuntime.ts`), not in
   `control/`, and the old generic name was itself what made this look like
   a competing "domain event" kernel. `tsc --noEmit` and the full test
   suite (`node --test tests/*.test.js`, 3212/3217, matching the
   established baseline) verified the rename.
4. Split `shadowOperationalRuntime.ts` along its four concerns only after
   characterizing existing behavior (tests or a captured trace) so the split
   can be verified to preserve it.
5. Split `desktopPersistenceStore.ts` by domain, keeping only SQLite
   wiring/migration orchestration in the persistence-store file itself.

## Consequences

Nothing in `apps/desktop/src` changes as a result of this ADR. It exists so
the next AI or human collaborator (per the cross-AI continuity contract) can
pick up items 1-5 above as scoped, reviewable, individually-synchronized
changes instead of one large unreviewed rewrite.
