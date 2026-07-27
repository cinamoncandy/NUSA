# Actual Gateway-backed Paper Safety Drills

`node scripts/run-risk-safety-drills.js` constructs deterministic Paper-only fixtures
and invokes `RuntimeCommandService`, its required command gate, the independent risk
gateway, and `PaperBroker`. The runner records state before and after each drill rather
than copying expected values into actual fields. Rejected or halted requests must have
zero broker calls and no order, cash, or position mutation.

The command writes output only when an explicit, non-existing `--output` path is
provided. Generated evidence and databases are not repository artifacts.
