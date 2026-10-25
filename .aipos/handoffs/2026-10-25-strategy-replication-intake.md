# Strategy Replication-First Research Intake handoff

## Durable objective

Owner direction: prioritize learning, reproducing, and independently validating already-published/public or otherwise owner-authorized strategies before spending Research capacity on zero-shot strategy invention.

Canonical work order:

- `.aipos/work-orders/WO-RESEARCH-20261025-STRATEGY-REPLICATION-INTAKE.yaml`
- parent issue: `#2735`
- branch: `feat/research-intelligence-precommit-bridge`
- base protected main at selection: `4bb02f4655044122a95e3dbb94bba65844c0f0cb`
- work-order creation commit: `42a3bf97513379eda94351a180b00d1c411c0e53`

## Canonical direction

`SCOUT/public strategy evidence -> provenance validation -> normalized reproducible StrategySpec -> deterministic identity/dedup -> immutable existing ResearchPrecommit -> PIT/OOS/walk-forward + realistic costs -> governed PAPER challenger consideration -> result/negative evidence -> later separate improvement/variant lineage`

This is a replication-first bridge, not a second Research Factory or strategy engine.

External reported CAGR/Sharpe/win-rate/drawdown/benchmark claims remain attributed external claims. They cannot satisfy NUSA validation, promotion, PAPER, Risk, Deployment, or LIVE gates.

The original strategy must be reproduced first and retained as the immutable baseline. Any parameter search, combination, AI-generated change, or improvement is a separate descendant with separate identity/evidence.

## AIPOS recovery / state note

`AGENTS.md` requires `.aipos/state.yaml` updates through `node scripts/aipos-state-insert.js <entry.yaml>` / `pnpm run aipos:state-add -- <entry.yaml>` so parallel PRs do not conflict on the large state file. This handoff was created through the repository API without a local workspace; therefore the canonical state insertion is deliberately **not fabricated by whole-file API replacement**.

The implementation session's first local metadata action is to insert a top-level state entry for this work order with the canonical insertion script, then validate AIPOS before implementation. Do not claim state registration complete until that script has run and the resulting diff is reviewed.

Suggested state entry semantics:

- work_order: `WO-RESEARCH-20261025-STRATEGY-REPLICATION-INTAKE`
- status: `READY`
- branch: `feat/research-intelligence-precommit-bridge`
- issue: `2735`
- next: `Implement deterministic public-strategy StrategySpec -> existing ResearchPrecommit replication bridge; external performance is metadata only.`
- safety: `PAPER_ONLY_LIVE_NONE_PRODUCTION_MUTATION_FALSE_AI_ZERO_AUTHORITY`

## Required implementation boundaries

- Reuse existing Research Intelligence, Hypothesis, Precommit, PIT/OOS, Strategy Governance, and PAPER gates.
- No new crawler in this work order.
- No proprietary code/assets/secrets import or access-control bypass.
- Missing/ambiguous provenance or executable rules => fail closed / `UNKNOWN`, never guessed.
- Deterministic source/spec fingerprints and deduplication.
- Preserve ORIGINAL_STRATEGY separately from POSSIBLE_VARIANT / NUSA improvements.
- #2815 and canonical explicit OHLCV provenance remain independent prerequisites for genuine performance claims where applicable.
- No synthetic OHLCV/history/receipts.
- No automatic PAPER promotion or activation.
- No LIVE/real-money authority, risk relaxation, self-approval, or self-merge.

## Governance

Before opening a PR, run local focused tests plus repository gates required by the work order. Do not use GitHub CI as an iterative debugger. Code/workflow PR must open Draft only after local validation, then receive fresh non-author exact-head validation and the existing deterministic Audit/Release path.

## Current truth at handoff

Only AIPOS planning records exist on this branch. Strategy intake implementation and tests are **not yet implemented or validated**. No strategy has been proven profitable or approved for PAPER by this work order.

Safety remains:

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `aiAuthority=ZERO_AUTHORITY`
- `VERIFIED=false`
