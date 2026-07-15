# Desktop Release Readiness

## Technical checks

Run `pnpm run release:check` after a frozen install. It runs portability preflight, strict TypeScript, the production build, and prints artifact byte sizes. It checks the current NSIS packaging contract, declared application entry point, and confirms that no auto-update dependency is present.

The check is deliberately not a release approval. `TECHNICAL_CHECKS_PASS` means only that deterministic repository checks passed.

## Security and accessibility boundary

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and sandboxing enabled.
- The renderer CSP permits only local assets and disables object, base, renderer network, and frame embedding sources.
- Main-process IPC validates order side, finite quantities, and boolean values. The renderer exposes only the limited preload surface.
- Renderer rendering of Paper orders, control events, portfolio values, and warnings uses `textContent` and DOM nodes rather than interpolating external strings into HTML.
- Existing labels, native buttons, focus-visible token styling, `role="alert"`, command-palette focus trapping, and reduced-motion CSS remain the accessibility baseline.

## Packaging status

- Windows NSIS installer: configured as `pnpm package:win`, with Electron entry point `dist/apps/desktop/src/main.js` declared in the package manifest.
- Portable executable: **NOT_CONFIGURED**.
- Application icon: **NOT_CONFIGURED**.
- Code signing: **NOT_CONFIGURED**; executable editing/signing is explicitly disabled for the unsigned NSIS build. Owner-provided certificate and Windows verification are required before distribution.
- Auto-update: **DISABLED**; no updater dependency or service is configured.

## Runtime evidence status

Startup time, renderer memory, DOM count, and interactive render latency require an installed Windows GUI measurement. They remain **NOT_EVALUATED**, not passing metrics. The current technical release is also blocked from any production or live-trading claim by the Paper evidence and owner-review gates.

## Required release evidence

1. Run frozen install, `release:check`, `pnpm test`, and `pnpm package:win` on a clean Windows workstation.
2. Install the generated NSIS artifact and complete the manual keyboard-only, screen-reader, 125/150/200% scaling, cold-start, reconnect, and crash-recovery smoke checks.
3. Record real Paper operational evidence and complete owner review. No fixture, test, or CI result substitutes for that evidence.
