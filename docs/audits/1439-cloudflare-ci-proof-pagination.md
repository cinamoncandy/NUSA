# #1439 Cloudflare exact-main CI lookup blocker

Observed on protected main `9c49915d60ee862f86d609a726fb7059ba756a88`:

- canonical main CI run `33580901911` completed successfully;
- Autopilot Cloudflare Deploy run `33581263047` remained in `Wait for exact-head CI success before deploying`;
- the workflow queried the generic exact-head completed-runs endpoint without `per_page=100` and selected by display name only;
- the same SHA has many completed workflow runs, so canonical CI can fall outside the default page even though it exists.

Minimum correction:

1. request `per_page=100` for the exact-head completed-runs lookup;
2. bind evidence to canonical path `.github/workflows/ci.yml`, not display name alone;
3. retain current-main verification, exact deployment revision verification, and fail-closed authority invariants unchanged.

This is a #1439/#903 control-plane recovery fix, not a second deployment path.
