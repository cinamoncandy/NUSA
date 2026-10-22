# SQLite shared integrity closure repair

PR #2855, branch `fix/sqlite-integrity-attestation-2770`.

## Candidate bootstrap preflight follow-up

The separate fresh NUSA Validator read parent head `4e5b0e75da292c23c4028251f4bd1e79fdd9f53b` and returned P0=0, P1=0, P2=5 with `ACCEPTED_WITH_CONDITIONS`, which does not meet the required explicit `ACCEPTED` gate. One condition was a real release-preflight gap: candidate systemd units could be selected without confirming `dist/packages/storage/src/sqliteIntegrityBootstrap.js` exists. The fail-closed artifact check and positive/negative regressions were committed and pushed to the existing PR branch at `4b6785323535b37bf0b0275ec7eb0f9f803d9d69`. That head's CI run 39773522607 and all eight companion workflows completed SUCCESS. Fresh Codex review then found P1 4348034655: the recovery records still directed a future session to commit/push the already-pushed preflight repair. This successor corrects those records only; all 4b CI/review receipts are historical for its new head. Do not repeat the source repair or create another commit solely to record workflow status. Keep Draft/HOLD and require fresh successor exact-head gates, non-author review, and explicit formal Validator `ACCEPTED` before Audit/Release. No Oracle mutation.

## Latest continuation (2026-10-22, constructor trust boundary)

The previously recorded Cloud PAPER preload successor is `65a0a047074a9c02193e533a33410cb5c71a6478` on protected base `21241b67e153bb8db15e566168fe3daef44b2cbf`. Fresh Codex review on that exact head found P1 `4346588560`: application code can replace the exported `node:sqlite.DatabaseSync` constructor after preload and before storage import, redirecting the requested persistent file to an in-memory connection while the protected native `prepare/get` still reports `quick_check=ok`.

The current local successor captures the native `DatabaseSync` constructor inside `sqliteIntegrityBootstrap`, exposes only a bounded `open(filename)` through the immutable boundary, and routes canonical plus standalone storage connections through it. Native constructor identity is checked with the captured clean-realm `Function.prototype.toString`; a corrupt-file child-process regression replaces the public constructor after preload and proves the forged constructor is never called and the corrupt requested file is rejected. This retains the full-file check and fail-closed behavior.

The review also identified a stale handoff P1 (`4346588569`): durable records omitted the Cloud PAPER source repair and current gates. This subsection and the active AIPOS work-order/state now describe both source repairs without asserting current-head workflow success. The 65a CI/companion receipts are historical after this constructor repair. Fresh exact-head workflows, non-author adjudication of all findings, and a separate formal NUSA Validator receipt with exact SHA/P0/P1/P2/`ACCEPTED` remain required. Keep #2855 Draft; no Audit, Release, merge, or Oracle mutation before those gates. `VERIFIED=false`.

## Current binding

### Latest continuation (2026-10-22)

This subsection supersedes older binding statements below. Protected main/base remains `21241b67e153bb8db15e566168fe3daef44b2cbf`. Exact reviewed head `aa313fc8a80005925c64c0c7fa6249c1da5814be` contained the immutable canonical-`Module` capability slot repair. Its seven companion/Android/PAPER workflows completed SUCCESS and its clean-install CI validation job completed SUCCESS through Security gate, Typecheck, Build and the repository validation stack while the overall CI run was still finalizing. Those receipts are historical after the next substantive successor.

Fresh non-author Codex review on `aa313fc8...` found a new P1: `index.ts` used a TypeScript default import for `node:module`. CommonJS `__importDefault` honors mutable `Module.__esModule` and `Module.default`, so post-preload application code could add `__esModule=true` plus a forged default object and redirect the integrity capability read without replacing the protected slot, loader, resolver, require dispatch, or cache.

The bounded repair uses TypeScript import-assignment syntax for `node:module`, which compiles to the raw CommonJS `require("node:module")` result. Production therefore reads `__nusaSqliteIntegrityBoundary` directly from the canonical constructor and does not traverse ES-module interop markers. A child-process regression preloads the genuine boundary, poisons `Module.__esModule/default`, opens a corrupt SQLite file, and requires rejection with zero forged checks.

This durable record remains self-stable: after the substantive raw-require repair and this record are committed, do not create a documentation-only successor merely to record the resulting SHA or workflow status. Require fresh exact-head workflows, fresh non-author P0/P1=0, and a separate formal NUSA Validator exact-SHA/P0/P1/P2/`ACCEPTED` receipt before Audit/Release. Keep PR #2855 Draft; no merge or Oracle mutation. `VERIFIED=false`.

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
