# Shadow Paper Pilot

WO-0033 phase 1 introduces an explicit-owner-started, Paper-only Shadow pilot. The
pilot shares production signal and risk-decision inputs but has no `PaperBroker`
dependency. It records only distinct `shadow-order-*` and `shadow-fill-*` identifiers.
Every Evidence event carries a sequence and a hash-chain link; any actual broker, order,
fill, cash, or position mutation is an invalid session condition.

`scripts/run-shadow-paper-pilot.js --dry-run` is a deterministic harness only. It does
not represent operational observation Evidence and cannot justify a STRONG D-010 grade.
Canary work is intentionally out of scope until this Shadow phase is independently
reviewed and committed.
