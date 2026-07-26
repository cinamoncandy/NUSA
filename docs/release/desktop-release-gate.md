# Desktop Release Gate

This is the release-readiness gate matrix for the Electron desktop app on
`agent/electron-upbit-paper-trading`. It reflects only evidence that actually
exists at the time it was written -- no gate below is marked PASS without a
linked, checkable source.

## Release candidate

- Candidate commit SHA: `4e5ce810919cb123c7055e3095222fd7e9353434`
- Branch: `agent/electron-upbit-paper-trading`
- PR: [#1](https://github.com/cinamoncandy/dokkaebi/pull/1) (Draft, open, unmerged)
- Installer artifact: none produced against this candidate SHA (see G-005..G-011)
- Signed artifact: none exists

## Gate matrix

| Gate | Requirement | Evidence | Status | Blocking |
|------|-------------|----------|--------|----------|
| G-001 | Typecheck (`pnpm run typecheck`) | CI runs [30203695151](https://github.com/cinamoncandy/dokkaebi/actions/runs/30203695151), [30203696362](https://github.com/cinamoncandy/dokkaebi/actions/runs/30203696362) -- both `success` for `4e5ce81` | PASS | Yes |
| G-002 | Build (`pnpm run build`) | same CI runs as G-001 | PASS | Yes |
| G-003 | Full test suite (`pnpm test`) | same CI runs as G-001 | PASS | Yes |
| G-004 | Electron preload/renderer bootstrap contract | `tests/electron-preload-renderer-contract.test.js`, `tests/electron-renderer-bootstrap.test.js` (added in `4e5ce81`), covered by the same green CI runs | PASS | Yes |
| G-005 | Startup diagnostics (structured main-process logging on load/crash) | no `apps/desktop/src/desktopStartupDiagnostics.ts` or equivalent exists on this branch | NOT_RUN | Yes |
| G-006 | Renderer crash-loop circuit breaker | no `apps/desktop/src/rendererRecoveryPolicy.ts` exists | NOT_RUN | Yes |
| G-007 | Single-instance lock | no `apps/desktop/src/windowActivationPolicy.ts` or `app.requestSingleInstanceLock()` wiring exists | NOT_RUN | Yes |
| G-008 | Graceful shutdown / resource cleanup | no `apps/desktop/src/desktopShutdown.ts` exists | NOT_RUN | Yes |
| G-009 | Packaged runtime file validator | no `scripts/validate-packaged-desktop.js` exists | NOT_RUN | Yes |
| G-010 | Package contents minimization / import closure | no `scripts/validate-packaged-import-closure.js` exists; `package.json`'s `build.files` is still the broad `["dist/**/*", "apps/desktop/**/*", "package.json"]` | NOT_RUN | Yes |
| G-011 | Windows CI packaging + artifact validation | no packaging step exists in `.github/workflows/*` beyond `pnpm test`; no `win-unpacked` build has ever run in CI | NOT_RUN | Yes |
| G-012 | Packaged offline Smoke launch | no `apps/desktop/src/desktopLaunchMode.ts`, no Smoke harness, no Smoke result exists | NOT_RUN | Yes |
| G-013 | NSIS install/uninstall Smoke | no `scripts/run-nsis-install-smoke.js` exists; NSIS packaging (`pnpm package:win`) is configured in `package.json` but has never been run in this branch's CI or recorded as evidence | NOT_RUN | Yes |
| G-014 | Authenticode / artifact SHA-256 manifest | no `scripts/verify-windows-authenticode.ps1`, no manifest tooling exists | NOT_RUN | Yes |
| G-015 | Protected production signing workflow | no `.github/workflows/windows-sign.yml` exists; code signing is `NOT_CONFIGURED` per `docs/release/desktop-release-readiness.md` | NOT_RUN | Yes |
| G-016 | Real Windows GUI acceptance (install, first launch, DPI, keyboard, screen reader) | no installed-Windows GUI session has been run against this candidate; this agent runs in a Linux, no-display sandbox and cannot perform it | NOT_RUN | Yes |
| G-017 | Paper Trading scenario acceptance (SCN-001..015, calculation invariants) | no scenario run or evidence export exists for this candidate; the underlying Paper domain logic has extensive pre-existing automated test coverage (unaffected by this gap), but no dedicated acceptance run/evidence bundle for release purposes exists | NOT_RUN | Yes |
| G-018 | Rollback plan | no prior signed/distributed version of the Electron desktop app exists to roll back to; no runbook has been written | NOT_RUN | Yes |
| G-019 | User data / persistence policy documented | partially covered by existing `docs/release/desktop-release-readiness.md` (no schema migration exists yet), but not written against a specific release candidate | NOT_RUN | Yes |
| G-020 | Owner approval | no explicit owner sign-off recorded for this or any candidate | PENDING | Yes |

## Overall judgment

**BLOCKED**

Per this repository's own gate definitions:
- BLOCKED applies when any required gate is `NOT_RUN`, `PENDING`, `FAIL`, or `BLOCKED`, or owner approval is pending, or a signed artifact is required but absent.
- 14 of 20 required gates (G-005 through G-018, plus G-019/G-020) are `NOT_RUN` or `PENDING`. None of them can be upgraded to PASS without evidence that does not yet exist.
- This is not a borderline call: the packaging, Smoke-test, NSIS lifecycle, signing, GUI-acceptance, and Paper-acceptance work items (WO-0007 through WO-0019 in this branch's work-order sequence) were never implemented. Verified directly against the filesystem and `git log` at the time of this assessment -- see "Evidence basis" below.

RELEASE_READY and RELEASE_CANDIDATE both require every gate above G-004 to have real, linked evidence. Neither applies here. REJECTED does not apply either -- nothing has been falsified, tampered with, or found unsafe; the work required to produce evidence simply has not been done yet.

## Evidence basis for this assessment

Checked directly against the repository at commit `4e5ce810919cb123c7055e3095222fd7e9353434` (HEAD of `agent/electron-upbit-paper-trading`, matching `origin/agent/electron-upbit-paper-trading`):

```
git log -10 --oneline
4e5ce81 test: verify Electron preload renderer bootstrap (WO-0006)
d7a8ded test: validate Electron desktop runtime assets (WO-0005)
e7af4f9 test: guard Electron renderer path resolution (WO-0004)
b878122 fix: correct BrowserWindow renderer path (WO-0003)
...
```

No commit exists for any work past WO-0006. File-level checks for the expected
artifacts of WO-0007 through WO-0017 (`desktopStartupDiagnostics.ts`,
`rendererRecoveryPolicy.ts`, `windowActivationPolicy.ts`, `desktopShutdown.ts`,
`scripts/validate-packaged-desktop.js`, `scripts/validate-packaged-import-closure.js`,
`scripts/run-nsis-install-smoke.js`, `scripts/verify-windows-authenticode.ps1`,
`apps/desktop/src/desktopLaunchMode.ts`, `.github/workflows/windows-sign.yml`)
all returned "does not exist."

## What is real and does count as evidence

- WO-0003 through WO-0006 (renderer path fix, regression test, desktop runtime
  integrity validator, preload/renderer bootstrap contract test) are genuinely
  implemented, tested, and CI-green on this exact candidate SHA.
- NSIS packaging is configured in `package.json` (`build.win.target: "nsis"`,
  `appId`, `productName`) and has been for longer than this work-order
  sequence, but has never been exercised in CI or recorded as release evidence.
- The pre-existing Paper Trading domain (`PaperBroker`, `RiskEngine`,
  `OrderPlanner`, etc.) has extensive automated test coverage from long before
  this Electron work began, and that coverage remains green. That is real
  confidence in the underlying calculation logic -- but it is not the same
  thing as a dedicated Paper-acceptance evidence bundle run against a
  packaged release candidate, which G-017 requires and does not have.
