# ADR-0015: Desktop module boundary remediation (proposal)

## Status

PROPOSAL. Not implemented. Recorded per `.aipos/architecture-governance.json`
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

1. Update `.aipos/functional-status.yaml` and `.aipos/module-map.yaml` to
   describe the *target* `apps/desktop/src` folder layout, get that reviewed,
   then execute the physical move + import rewrite + surface-governance path
   update in one atomic change, verified by `tsc --noEmit` and the full
   `pnpm run architecture:check` / `pnpm run aipos:drift` suite.
2. Only after (1), extract `main.ts`'s IPC handler bodies into per-domain
   handler modules under the new folders, leaving `main.ts` as
   lifecycle + registration wiring only. Update
   `scripts/validate-architecture-surfaces.js`'s anchored path alongside it.
3. Audit `domainEventBus.ts` vs `packages/core/src/eventBus.ts` for semantic
   equivalence; either extend the core bus with the missing guarantees and
   migrate call sites, or explicitly document why a second bus is a deliberate
   exception (and get that exception approved, since the architecture
   contract currently reads as a flat prohibition).
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
