# NUSA Security and Supply-Chain Review

Audit date: 2026-08-01
Audited recovery head: `1be2482c2f4bffe809790fc613bd088dcea94af5`

## Dependency results

- `pnpm audit --prod`: PASS, no known vulnerabilities.
- `pnpm audit`: FAIL as an advisory report with 2 high and 1 moderate
  development/build findings.
- `ws@8.18.3`: transitive through `jsdom`/Vitest only; production `ws` is
  pinned at `8.21.0`.
- `brace-expansion@1.1.16`: transitive through electron-builder's build graph;
  patched versions are present in other branches of the graph, but the legacy
  minimatch path remains build-time only.

These were not force-upgraded during repository recovery. Production runtime
has zero known advisories. The remaining transitive development/build findings
are recorded for a focused dependency task rather than changed through a broad
upgrade.

## Secret and capability scan

The redacted pattern scan found no committed key, token, private-key material,
Bearer credential, or Upbit environment secret. A match in
`tests/product-release-readiness.test.js` is static safety-test vocabulary, not
a credential.

Verified safety boundaries:

- `productionMutationAllowed=false`
- live trading disabled
- private API capability absent
- credential storage absent
- renderer/preload trust-boundary tests present
- package validation rejects live/credential paths

No credential rotation is required from the current scan.
