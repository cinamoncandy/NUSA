# Cloudflare deployment probe

This file intentionally lives under `apps/autopilot/` so the exact-head CI → `cloudflare-production` promotion path can be exercised after the lineage-safe workflow change.

It does not add runtime authority, execution capability, or production mutation behavior. The production Worker remains fail-closed with `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
