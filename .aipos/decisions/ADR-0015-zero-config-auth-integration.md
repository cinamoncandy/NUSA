---
id: ADR-0015
title: "Combine canonical origin and mobile session transport"
status: ACCEPTED_FOR_IMPLEMENTATION
date: "2026-08-16"
decision: "Protected mobile clients may use only the canonical HTTPS origin plus MobileSessionAccess authorization provider; operator/dashboard credentials remain excluded."
constraints:
  - "No endpoint, port, tunnel, enrollment secret, or dashboard bearer in normal production UX."
  - "PAPER-only, liveAuthority=NONE, productionMutationAllowed=false, AI ZERO_AUTHORITY."
  - "Missing secure storage or approved enrollment proof fails closed; no AsyncStorage/plaintext fallback."
rejected:
  - "Reuse dashboard bearer as mobile session."
  - "Build a fixed enrollment proof into the APK."
  - "Treat local SIGNED_IN as server authentication."
---
