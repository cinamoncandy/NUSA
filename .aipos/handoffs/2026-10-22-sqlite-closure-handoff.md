# SQLite shared integrity closure repair

PR #2855, branch `fix/sqlite-integrity-attestation-2770`.

## Current binding

### Latest continuation (2026-10-22)

This subsection supersedes older binding and local-validation statements below. Fresh GitHub shows protected main/base `21241b67e153bb8db15e566168fe3daef44b2cbf` and PR #2855 exact reviewed head `4f44517c704786b9c7334a722f83194614bcc3ca`, OPEN/DRAFT/mergeable. That exact head passed CI `39733540736`, Research advisory `39733540815`, Capability `39733540744`, Activation `39733540747`, Transport `39733540790`, Read-only Broker `39733540904`, Actual PAPER `39733540789`, and Android Guard `39733540809`. Those receipts are historical after any successor commit.

Fresh non-author Codex review on `4f44517c...` produced two current P1 findings. First, the native `_resolveFilename` pinned by that head still calls writable `Module._findPath`; replacing only `_findPath` can route `./sqliteIntegrityBootstrap` to an attacker-added cache entry and forge `quick_check=ok`. Second, the recovery records still described the already-committed resolver repair as local/pending.

The substantive repair removes the vulnerable production transition instead of pinning resolver internals indefinitely: the trusted preload publishes the frozen `sqliteIntegrityBoundary` directly on a non-writable/non-configurable property of Node's canonical `Module` constructor, and production storage reads that immutable slot. Therefore storage does not resolve `./sqliteIntegrityBootstrap` after the preload, so mutable resolver helpers such as `_findPath` or `_resolveLookupPaths` cannot substitute the integrity capability. Direct developer/test imports retain the bootstrap fallback only when the trusted preload slot is absent. An adversarial child-process regression replaces `_findPath` after preload, targets only the old bootstrap request, opens a corrupt SQLite file, and requires both zero forged resolutions and corrupt-database rejection.

This durable record is self-stable: resolve the branch head dynamically. Once the substantive capability-slot repair and this record are present, do **not** create a documentation-only successor merely to record the resulting SHA or workflow status. Only a new substantive code/recovery finding justifies another commit. Fresh exact-head workflows, non-author P0/P1=0, and a separate formal NUSA Validator exact-SHA/P0/P1/P2/`ACCEPTED` receipt remain required before Audit/Release. Keep PR #2855 Draft; no merge or Oracle mutation. `VERIFIED=false`.

## Current P1 closure

Fresh Codex review on `9e4d6688...` found two current P1s:

1. `Module.prototype.require` remained replaceable after the trusted preload, so generated CommonJS `require("./sqliteIntegrityBootstrap")` could bypass the already-pinned `Module._load` and return a forged integrity boundary.
2. This handoff still described the already-committed loader repair as local/pending and contradicted the state/work-order security-gate record.

Source repair `dd60977f...` captures the native `Module.prototype.require` descriptor during the trusted preload and pins it non-writable/non-configurable alongside `Module._load` and `Module._cache`. The new child-process adversarial regression attempts that exact replacement, then proves a deliberately corrupt SQLite database is still rejected and the forged require path is never invoked. After exact-head `e5717083...` workflows passed, protected main advanced to `94726afc...` through the Storybook security advisory merge. The branch was synced; the `pnpm-lock.yaml` conflict was resolved with the exact protected-main lockfile and `pnpm install --lockfile-only --frozen-lockfile` passed. All e571 receipts are historical after this base sync.

The repair does not weaken the canonical full-file `quick_check`, four AI store-scoped checks, hash-chain replay, startup/recovery ordering, PAPER writer lease, Research child 256 MiB heap propagation, Risk/Governance thresholds, or the 300-second readiness budget.

## Evidence

Before the new P1 was found, exact head `9e4d6688...` completed successfully on CI `39708723397`, Mobile Native `39708723564`, Research advisory `39708723368`, Transport `39708723488`, Activation `39708723348`, Capability `39708723272`, Actual PAPER `39708723273`, Read-only Broker `39708723438`, and Android Guard `39708723475`. Those receipts are historical after source repair `dd60977f...`.

On the `dd60977f...` source tree:
- changed storage TypeScript transpile diagnostics: PASS;
- exact `Module.prototype.require` replacement regression: PASS;
- focused PAPER startup + writer-lease tests: 23/23 PASS;
- `git diff --check`: PASS.

Full local `tsc` is not claimed: this Oracle validation host hit its existing ~258 MiB Node heap ceiling and exited OOM.

## Remaining gates

This handoff is deliberately self-stable: resolve the PR head dynamically from GitHub. If the current branch contains source repair dd60977f... and this durable record, **do not create another documentation-only successor merely to record the current head SHA or workflow status**. A new commit is justified only by a new substantive code/recovery finding.

For the dynamically resolved post-sync current head, require:
1. fresh exact-head required workflows;
2. fresh non-author review/adjudication with zero current P0/P1;
3. a separate formal NUSA Validator receipt bound to the exact SHA with P0/P1/P2 counts and explicit `ACCEPTED`;
4. only after that, Independent Audit → Release authorization → protected-main merge → exact-main Oracle PAPER runtime acceptance.

Oracle `/health`, `/ready`, deployed source SHA, genuine PAPER fill/PnL, restart/replay, and learning-loop continuity remain UNVERIFIED. No Oracle mutation or runtime acceptance is claimed.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `realTransferAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, `VERIFIED=false`.
