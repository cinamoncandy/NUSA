# External Review Hardening — 2026-07

## Scope

This change set closes the seven repository review findings without adding LIVE trading capability.

## Findings and remediation

1. **Machine-specific package scripts**
   - Root scripts use package-local commands only.
   - `scripts/validate-repository-portability.js` rejects Windows user paths, Unix home paths, Codex cache paths, and reconstructed package versions.
   - `pnpm preflight` is mandatory before test, desktop launch, and packaging.

2. **`node:sqlite` runtime ambiguity**
   - `package.json` declares Node.js `>=24.0.0` and pnpm `>=11.7.0`.
   - `scripts/check-runtime.js` verifies `DatabaseSync` is available without production dependence on `--experimental-sqlite`.
   - Unsupported runtimes fail with an actionable message.

3. **README absence/incompleteness**
   - README now covers purpose, install, run, validation, safety, execution semantics, SQLite migrations, dust policy, versions, and directory responsibilities.

4. **Execution naming ambiguity**
   - Execution is explicitly defined as a deterministic Paper/execution-model boundary.
   - It does not represent an exchange adapter, private API integration, or LIVE order sender.
   - Existing paths are retained to avoid a broad breaking rename; semantics are documented instead.

5. **Migration scalability and governance**
   - The existing migration runner already enforces `NNN_name` IDs, strict ordering, uniqueness, non-empty SQL, transactionality, applied history, unknown-ID rejection, and SHA-256 checksum verification.
   - Legacy rows without checksum are backfilled once; conflicting checksums fail closed.
   - Applied migrations are immutable; schema changes require a new migration ID.

6. **Partial-sell integer division and dust**
   - `PaperRiskPolicy` now includes `quantityStep` and `dustThreshold`.
   - Incoming quantities are floored to the configured step.
   - Residual quantities at or below dust threshold are normalized to zero.
   - Regression tests cover flooring, full close, and below-step rejection.

7. **Reconstructed source/version concern**
   - Root and desktop packages use SemVer `0.1.0`.
   - Repository validation rejects package versions containing `reconstructed`.
   - Runtime, research, committee, Git, and dataset versions remain explicit in provenance contracts.

## Safety result

No private exchange API, credential handling, withdrawal, automatic promotion, capital allocation, or LIVE order path was added. The repository remains PAPER/DRY_RUN only and the pull request remains Draft.
