# Learning daemon fatal recovery handoff

WO-OPS-20261015-LEARNING-FATAL-SHUTDOWN, branch
codex/learning-fatal-shutdown-20261015, base8c297c97.

Current scheduler fatal handler records error, sets exitCode1 and stops services,
but a residual active handle can prevent exit and supervisor recovery. Isolated
child red reproduced timeout; daemon regression red fatal cases timed out while
normal signal passed after correcting a compiler-import alias in the harness.
This is a bounded recovery gap, not proof of the historical outage initiating cause.

Minimal fix: optional composition-owned fatal-shutdown callback; daemon main
routes it through its existing registerGracefulShutdown controller, maps fatal
shutdown to exit1, normal signal remains0. Embedded callers retain prior stop-only
behavior. No second controller, lifecycle framework, queue, restart engine or
Risk policy. Tests execute compiled main and compiled scheduler failure handler
with canonical shutdown, isolated composition/storage fixtures and active handle.

Build/typecheck and15 targeted tests PASS, including repeated fatal stop-once,
rejected stop, ordinary signal, controller timeout. Full validators/security/lint
PASS(24 existing warnings). Fresh non-author review PASS no P0/P1/P2; reviewer
independently ran15 tests and2 signal/fatal overlap probes. Full isolated suite
PASS1225 files; only generated isolated-test-failure.txt deletion restored to
baseline. No deployment/operational fault injection yet. Exact-head CI/Audit/
Release and approved PAPER deployment remain required.
PAPER_ONLY; liveAuthority=NONE; productionMutationAllowed=false;
aiAuthority=ZERO_AUTHORITY. Full learning remains UNVERIFIED.
