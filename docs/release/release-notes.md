# NUSA Release Notes

## Current recovery build

This recovery build consolidates the existing Paper, Shadow, recovery, Evidence,
operations, and Windows packaging work under the NUSA product name.

- Paper mode remains the default.
- Live trading and authenticated exchange mutation remain disabled.
- `productionMutationAllowed` remains `false`.
- The desktop Operations snapshot is read-only and reports market, Shadow,
  preflight, recovery, reconciliation, and safety counters from the main process.
- Existing Evidence and recovery records are retained; no historical record is
  rewritten by the product rename.

Before distributing a build, complete the release checklist and record the exact
commit, build manifest, package validation result, and Windows installer smoke
test result.
