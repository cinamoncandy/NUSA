# Immutable ineligible pending-period storage contract

Status: IMPLEMENTED FOR REVIEW; NOT ACCEPTED OR ACTIVATED.

Owner scope: the 2026-10-16 integrated master explicitly authorizes the minimum disposition contract where the existing architecture cannot represent unknown costs. This authorizes development, not self-approval, production mutation, or bypass of independent Audit/Release.

## Why existing states are insufficient
COMPLETED/REJECTED/HALTED realized envelopes require numeric spread/slippage and benchmark/returns. A historical unknown-cost fill cannot enter those envelopes truthfully. Existing retirePending deletes the plan and emits only bounded observability. Neither represents immutable ineligible evidence.

## Minimal storage change
The existing research_paper_forward_period_pending table retains the original row identity/index/start. Its payload becomes a schemaVersion=2 INELIGIBLE_PENDING_PERIOD envelope containing exact original payload bytes/checksum, a bounded PERIOD_CLOSE / INCOMPLETE_EXECUTION_COST_EVIDENCE reason, observing runtime revision (null explicitly means unavailable), blocked-evidence fingerprint, successor snapshot and deterministic disposition fingerprint. It contains no invented returns/costs, no strategy-failure inference, and no performance qualification.

The original and successor are bound by one BEGIN IMMEDIATE transaction with checksum comparison. Receipt persistence followed by a failed successor insert rolls back both. Identical replay returns the same terminal evidence even after successor observations advance. Conflicting evidence fails closed. Multiple active successors or overlapping chronology are rejected. Terminal rows cannot be updated, retired, finalized, re-used as realized output, or pruned by realized retention.

No new table, migration, ledger, scheduler, controller, Research engine or authority exists. The schema wrapper is deliberately unreadable by old schemaVersion=1 producer/readers: rollback must fail closed after activation rather than resurrect an ineligible plan.

## Activation dependencies — NOT DONE
This increment adds a storage contract only. No production caller invokes markPendingIneligible. Before any runtime activation:
1. Fresh non-author architecture/contract review and canonical Audit/Release acceptance.
2. #2741 governed merge/deployment and actual future-fill complete-cost recurrence acceptance.
3. Existing producer must derive the reason and fingerprint from immutable canonical fills and reproduce the exact reconciliation failure. It must never trust a caller-supplied diagnosis alone.
4. An admissible boundary must preserve exposure/cost basis. The initial integration must remain blocked until the canonical account is flat and no active order remains; no forced sell, account reset, or basis rewrite.
5. Upgrade the existing pending reader, producer recovery, index allocation, scheduler result and read-only eligibility breakdown together. Index allocation includes terminal reservations. Never treat INELIGIBLE as a failed strategy or feed it to Performance/Governance/Feedback.
6. Crash/restart/replay tests must cover the actual production assembly, not only storage helpers. Existing failure history survives later success.
7. Old deployment rollback after schema activation requires explicit fail-closed compatibility handling; no deletion or downgrade of terminal history.

Current historical fill/ledger, 21 realized periods, capital, qualification criteria, Risk and writer lease semantics remain unchanged. Actual learning progression and restart/replay acceptance remain UNVERIFIED.

## Latest exact-main evidence
Protected main and deployed runtime matched 67630b806996a0774fa41d772e61de6192493a84. After controlled restart/replay, authenticated readiness returned HTTP 200 with all four checks true; the durable ledger contains 170 fills with 170 unique identities, including 169 cost-attributed fills and one immutable INCOMPLETE-cost fill. The latest fill has OBSERVED attribution. The runtime retained 21 realized periods and one pending period; learning cycles remain zero with `INCOMPLETE_EXECUTION_COST_EVIDENCE`. Account positions are zero quantity and there are no working orders. The disposition API has not been activated, so the historical fill/period was not changed.
