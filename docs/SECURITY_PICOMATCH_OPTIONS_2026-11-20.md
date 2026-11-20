# picomatch advisory: options for the owner (2026-11-20)

Advisory: audit id 1247710, GHSA-fc5q-39xc-vjpf, high, ReDoS. Installed: picomatch 2.3.2 and 4.0.7.
Owner exception in `scripts/security-gate-backports.js` (`OWNER_EXCEPTIONS`) expires **2026-12-02T00:00Z**.
After that the security gate fails and blocks every merge.

## Decision needed (owner, before 2026-12-01)

No fixed version exists, so this cannot be resolved by an override. The exception must be extended
(a new owner-signed date, a separate small PR) or one of the options below must be taken. This PR changes
neither the gate nor the exception.

## Evidence

- Registry (`npm view picomatch`, checked 2026-11-20): latest and only dist-tag is 4.0.7 (published 2026-08-24);
  newest 2.x is 2.3.2, newest 3.x is 3.0.2. No version newer than the two installed ones exists in either line.
- Lockfile dependents (`pnpm why picomatch`, `pnpm-lock.yaml` snapshots):
  - 2.3.2: `micromatch@4.0.8` (via `fast-glob`, the React Native community CLI, `metro`) and `jest-util@29.7.0`
    (via `jest-worker`, `metro`). Mobile build/test tooling only.
  - 4.0.7: `tinyglobby@0.2.17`, `fdir@6.5.0`, `vite@7.3.7`, `vitest@4.1.11`. Test/build tooling only.
- Reachability: no first-party source imports picomatch (only the gate script and its test mention the name).
  Every path is a dev/build/test tool matching file globs that come from our own repo config, not from untrusted
  input, and none is in the runtime or server path. ReDoS needs an attacker-controlled glob or input string.
  Residual risk is a hung local or CI job, not data exposure. This is an inference from the dependency graph;
  the vulnerable function was not exercised.
- Advisory text: not readable from this sandbox (the GitHub advisory API is blocked for this session), so the
  exact vulnerable function and any patched range are unverified. The registry shows no patched release.

## Options

| Option | Cost | Note |
|---|---|---|
| A. Extend the exception by a fixed short period (for example 14 days) | One-line date change plus test update, owner-signed | Cheapest. Re-check the registry on the new date. Recommended. |
| B. pnpm patch of picomatch 2.3.2 and 4.0.7 | Needs the upstream fix to be known; two patches, lockfile churn, patch upkeep; the audit still reports the version, so the gate would still flag it | Not useful for the gate unless the gate learns about patches. Not recommended. |
| C. Replace the consumers (swap vite/vitest, jest, metro tooling) | Very large; the mobile toolchain pins these | Not realistic. |
| D. Remove the gate rule for this id | Weakens the gate | Not allowed without owner decision; not recommended. |

## Recommendation

Choose A: extend the existing exception once, owner-signed, for a short window, and re-check
`npm view picomatch versions` on the new date. When upstream publishes a fix (a version above 4.0.7, or a
2.x/3.x patch), add a `pnpm-workspace.yaml` override, and remove the `OWNER_EXCEPTIONS` entry and its fixtures in
`tests/security-backports.test.js` in the same PR.

## Not verified

`pnpm run security:gate` and a fresh audit call were not run (Node 22 in this sandbox, the repo wants Node 24).
The advisory text was not read.


## Owner decision (2026-11-20 KST): option A

The owner chose option A ("A"): one short extension of the existing owner exception, from 2026-12-02 to **2026-12-16**, with the same exact scope (audit id 1247710, picomatch, installed versions 2.3.2 and 4.0.7, severity high). No gate rule, version, advisory or package was widened. The exception still prints on every run. Before 2026-12-16 the registry is checked again for a fixed picomatch; if none exists the owner decides again (a second extension is not automatic). Applied in `scripts/security-gate-backports.js` and `tests/security-backports.test.js` (the boundary dates only).
