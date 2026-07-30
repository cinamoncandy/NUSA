# NUSA Release Process

## Inputs

Release builds are created from a clean `main` commit on Windows x64. The package version remains `Major.Minor.Patch`; the immutable Git commit and UTC build time are recorded in `release/build-manifest.json`.

## Build

1. `pnpm install --frozen-lockfile`
2. `pnpm run preflight`
3. `pnpm run typecheck`
4. `pnpm run build`
5. `pnpm test`
6. `pnpm run test:ui`
7. `pnpm run package:validate`
8. `pnpm run release:manifest`
9. `pnpm run release:check`

`release-engineering.js` writes a build manifest, SHA256 checksum, and artifact manifest. `package:win` is the Windows NSIS packaging command; it is not run by `release:manifest`.

## Safety gate

The release is blocked if any required check fails or if the capability descriptor does not report `productionMutationAllowed=false`. No release step enables live trading or accepts credentials.
