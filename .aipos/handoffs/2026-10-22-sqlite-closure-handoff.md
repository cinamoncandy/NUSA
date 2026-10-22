# SQLite shared integrity closure repair

PR #2855, branch `fix/sqlite-integrity-attestation-2770`.

## Current binding

### Latest continuation (2026-10-22)

This subsection supersedes the older binding and local-validation statements below. Protected main `21241b67e153bb8db15e566168fe3daef44b2cbf` was merged into remote PR head `b745449433f458463242f83f4affc7754c898ded` in local successor `215ba83ed2b63fdf3a17e81184cea8c083167c86`. After the AIPOS edits in this successor, resolve the final PR head from GitHub dynamically; do not infer it from this handoff.

On the merged code tree before these AIPOS-only edits: `pnpm run build`, `pnpm run typecheck`, focused SQLite startup/writer-lease plus changed-main mobile regressions (38/38), `pnpm run validate:full`, `pnpm run aipos:provenance`, `pnpm run security:gate`, and `pnpm run lint` all passed. Lint reported 36 warnings and zero errors. `git diff --check` passed. Earlier remote workflows for `b745449...` are historical after the main sync; exact-head remote workflows, fresh non-author review, and formal NUSA Validator are pending for the pushed successor.

Six current non-outdated review threads were still unresolved on `b745449...`. The `Module.prototype.require` source fix and adversarial test are present, but reviewer closure is still required. Also re-evaluate the other threads against the synced exact head; an author reply is not a non-author receipt. Keep PR #2855 OPEN/DRAFT; Audit, Release, merge, and Oracle mutation remain prohibited pending their separate gates. Oracle runtime SHA, genuine fill/PnL, restart continuity, and learning-loop acceptance remain UNVERIFIED.

- Protected `main`: `94726afcfc0fdadf267df0b0ecb8494abd801e98` (freshly merged into the PR branch; resolve the current PR head dynamically).
- Fresh review finding head: `9e4d668829247a397018089fc6bd981f5ad81db0`.
- Current committed source repair: `dd60977f35e9ae81fccaaac65b1bc110a6fe0ac4`.
- PR remains OPEN / Draft. Resolve the remote branch head dynamically immediately before any push.

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
