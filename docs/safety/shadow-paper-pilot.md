# Shadow Paper Pilot

WO-0033 phase 1 introduces an explicit-owner-started, Paper-only Shadow pilot. The
pilot shares production signal and risk-decision inputs but has no `PaperBroker`
dependency. It records only distinct `shadow-order-*` and `shadow-fill-*` identifiers.
Every Evidence event carries a sequence and a hash-chain link; any actual broker, order,
fill, cash, or position mutation is an invalid session condition.

`scripts/run-shadow-paper-pilot.js --dry-run` is a deterministic harness only. It does
not represent operational observation Evidence and cannot justify a STRONG D-010 grade.
The phase-3 independent verifier distinguishes this dry run from
`SHADOW_OPERATIONAL` evidence. Only a public-market, elapsed-time operational session
with a verifier PASS may count toward the documented observation criteria; neither form
of evidence changes a runtime mode.

WO-0034-A2 (`apps/desktop/src/shadowOperationalRuntime.ts`) replaces the dry-run harness's
synthetic signal with the actual production signal, generated from the real public Upbit
ticker aggregated into closed candles. The pilot's own risk decision is the same
`PaperCommandRiskGate` decision `RuntimeCommandService` uses for real orders -- not a
separately fabricated `ALLOW`. Owner-controlled `shadow:start/pause/resume/stop/status`
lifecycle commands exist; see `docs/operations/shadow-owner-lifecycle.md`. This phase
still does not persist a session across a restart and still does not write durable
`SHADOW_OPERATIONAL` Evidence -- both remain WO-0034-A3.
