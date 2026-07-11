# AGENTS

This file defines repository-wide instructions for human and automated contributors.

## Read First

Before changing code, read:

1. `DOKKAEBI.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ROADMAP.md`
4. The nearest package source and tests

When a future task-specific handoff file exists, read it after these repository-wide documents.

## Engineering Rules

- Use TypeScript and keep `strict` type checking enabled.
- Use `bigint` for raw quantities, quote values, cost basis, prices, and PnL.
- Never convert accounting values to `number`, `parseInt`, or `parseFloat`.
- Preserve ledger order: `ts ASC, createdAt ASC, id ASC`.
- Preserve original error objects across transaction rollback.
- Keep audit operations read-only.
- Keep rebuild operations explicit and transactional.
- Keep the pre-trade risk engine pure. It must not import storage, repositories, network clients, or exchange adapters.
- Never add credentials, tokens, database runtime files, generated output, or environment-specific secrets to Git.
- Do not add live-trading behavior without explicit task requirements and a reviewed safety design.

## Architecture Boundaries

- `packages/contracts` owns shared types, enums, validation, and constructors.
- `packages/storage` owns persistence, repositories, transaction boundaries, projections, applied markers, and repair.
- `apps/execution` owns pure execution-domain decisions currently limited to pre-trade risk.
- Tests should observe public behavior and persistence outcomes, not implementation text.

Dependencies flow toward contracts. Execution-domain pure logic must remain independent of storage.

## Verification

Run all applicable checks before reporting completion:

```powershell
pnpm run typecheck
pnpm run build
pnpm test
```

Report command failures verbatim enough to make the failure actionable. Do not replace `tsc` with a custom syntax checker and do not count generated placeholder cases as meaningful coverage.

## Git and Review

- Branch names should use `agent/<short-description>`.
- Keep commits focused and use terse imperative messages.
- Do not stage unrelated user changes.
- PR descriptions must state what changed, why, user or developer impact, and exact validation commands.
- Update architecture or roadmap documentation when a change alters boundaries, guarantees, or delivery order.
