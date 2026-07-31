# A5H Windows Release Candidate Acceptance

## Basis

- Branch: `agent/a5g-production-release`
- HEAD: `364fca6c6607ab00d12b4003c44991fed517e624`
- Version: `0.1.0`
- Signature: `UNSIGNED_BUILD`

## Artifact identity

| Artifact | SHA-256 | Result |
| --- | --- | --- |
| `Dokkaebi-0.1.0-Windows-Setup.exe` | `49988913d2a096aea9f3bd40d00aa3e27bbee78b9cdf2c920579ad47e717b049` | MATCHED |
| `Dokkaebi-0.1.0-Windows-Portable.exe` | `7fad900f62eac44ef34928c735ef5eb32d06eb96b88660318efde1c37059c890` | MATCHED |

`verification.json` confirms version `0.1.0`, the source commit above, and
`productionMutationAllowed: false`. The artifact allowlist, checksum file,
SBOM, and verification JSON were generated successfully.

## Automated checks

- Frozen install: PASS
- Preflight: PASS
- Typecheck: PASS
- Build: PASS
- Full tests: PASS, 262 isolated test files
- UI tests: PASS, 4 tests
- Package validation: PASS
- Release validation: PASS
- Artifact verification: PASS
- `productionMutationAllowed`: false
- Private API and credentials bundled: no evidence found

## Signature

`Get-AuthenticodeSignature` returned `NotSigned` for both artifacts. They are
internal unsigned RC artifacts only, not Production Releases.

## Windows acceptance status

The following require a real Windows user/session and are intentionally **NOT
RUN** here; they must not be reported as PASS without evidence:

- Clean installer install and first launch
- Standard-user and administrator install
- Space-path and Korean-path launch
- Renderer/UI smoke test
- Portable launch and data-directory isolation
- Crash/restart recovery
- Backup/restore smoke test
- Upgrade from a previous installer
- Uninstall and reinstall
- Network fault and sleep/resume checks
- Two-hour soak test
- Authenticode/SmartScreen acceptance

## Decision

`CONDITIONAL PASS` for internal unsigned RC artifact verification only.

`PRODUCTION RELEASE: NOT APPROVED` until signed artifacts and the Windows
acceptance checklist are completed with retained evidence. Live activation,
automatic order submission, automatic session resume, and credential bundling
remain disabled.
