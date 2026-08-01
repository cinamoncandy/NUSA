# NUSA Dependency Maintenance Report

Audit date: 2026-08-02
Audited commit: `d820cff5a89362fd467690ec08c9e492f489ddd3`

## Direct dependencies

| Dependency | Result | Evidence |
|---|---|---|
| `ws` | RETAIN | Imported by `apps/desktop/src/upbitWebSocket.ts`; pinned in `package.json` and package validation |
| `electron` | RETAIN | Desktop scripts and runtime packaging |
| `electron-builder` | RETAIN | Windows and portable packaging scripts |
| `@playwright/test` | RETAIN | `playwright.config.*` and E2E suite |
| `vitest` | RETAIN | `vitest.config.mjs` and UI suite |
| Storybook packages | RETAIN | Storybook scripts/configuration |
| `typescript` / Node types | RETAIN | Typecheck/build configuration |
| `eslint` | RETAIN | ESLint configuration and lint script |

No unused direct dependency was proven. No dependency was removed speculatively.

The many `@dokkaebi/.ignored_*` directories under installed `node_modules` are not package.json dependencies and were excluded from source graph analysis; they are not repository files to remove in this slice.

## Lockfile and installation

The project remains pinned to `pnpm@11.7.0`, Node `>=24.0.0`, and the existing frozen-lockfile contract. No dependency versions or lockfile entries were changed.
