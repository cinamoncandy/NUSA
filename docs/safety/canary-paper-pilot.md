# Canary Paper Pilot

WO-0033 phase 2 provides a bounded Paper-only Canary runtime. A Canary session binds a
single owner approval, source commit, symbol, strategy and four safety fingerprints. It
can only start after explicit precheck and owner action; a valid restored approval never
starts or resumes a session.

Every order is evaluated by the existing `RuntimeCommandService` risk gate after the
Canary limit gate. Limits include duration, order count, quantity and notional. A limit
or safety failure changes the session to a terminal safe state before another broker
call. Restart invalidates a running Canary session and does not resume it.

`scripts/run-canary-paper-pilot.js --dry-run --approval <path>` validates a locally
provided approval shape without writing operational evidence or calling a broker.
Phase 3 independently verifies complete event chains, approval binding, and the
aggregate promotion gate. A dry run remains non-operational evidence and cannot count
orders or trades toward the promotion criteria.
