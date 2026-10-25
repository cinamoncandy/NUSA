# Strategy Replication-First + Crypto News Research Intake handoff

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

`SCOUT/crypto news -> immutable content snapshot + fingerprint/PIT check -> observed facts / publisher claims / Scout inferences separated -> explicit testable ResearchHypothesis -> existing ResearchPrecommit -> PIT/OOS/cost evaluation`

This is a replication-first bridge, not a second Research Factory or strategy engine.

External reported CAGR/Sharpe/win-rate/drawdown/benchmark claims remain attributed external claims. They cannot satisfy NUSA validation, promotion, PAPER, Risk, Deployment, or LIVE gates.

The original strategy must be reproduced first and retained as the immutable baseline. Any parameter search, combination, AI-generated change, or improvement is a separate descendant with separate identity/evidence.

## AIPOS recovery / state note

`AGENTS.md` requires `.aipos/state.yaml` updates through `node scripts/aipos-state-insert.js <entry.yaml>` / `pnpm run aipos:state-add -- <entry.yaml>`. The canonical entry was inserted with that script and is now `IN_PROGRESS`; the existing work order was expanded for crypto news without creating duplicate work.

State entry semantics:

- work_order: `WO-RESEARCH-20261025-STRATEGY-REPLICATION-INTAKE`
- status: `IN_PROGRESS`
- branch: `feat/research-intelligence-precommit-bridge`
- issue: `2735`
- next: `Review contract semantics and complete remaining local full-suite environment gate; then refresh preflight and all required gates before any Draft PR.`
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

Implemented locally on the existing branch:

- deterministic StrategyReplicationSpec normalization, ORIGINAL/VARIANT identity, external performance isolation, and bridge to existing `ResearchPrecommit`;
- crypto news observation contract with content snapshot SHA-256 check, publication/first-observed/retrieval chronology, social/rumor fail-closed PIT status, separated facts/claims/inferences, and exact/syndication duplicate classification;
- explicit-only news hypothesis adapter to existing `ResearchHypothesis` and `ResearchPrecommit` (requires caller-supplied testable assumptions; no order path);
- 8 focused tests PASS; TypeScript build/typecheck, `validate:full`, `security:gate`, `lint`, Node 24.19 `preflight`, and `git diff --check` PASS.
- `pnpm test` PASS: 1,281 isolated test files. Initial Electron installation failed because Node fetch did not use the session proxy; installing the official Electron package with `NODE_OPTIONS=--use-env-proxy` resolved the environment issue without source/test changes.

No strategy has been proven profitable, persisted as an accepted research result, or approved for PAPER by this work order. The current implementation is a contract slice; production Scout composition, durable result consumption, exact-head CI, non-author validation, Audit/Release, and natural Research/PAPER outcomes remain outstanding. PR #2878 head `2d13d51f...` was found to accept unknown runtime taxonomy values; the fix now validates source/event/confidence allowlists and malformed evidence arrays. All local gates, including 1,281 isolated tests, pass on that repaired working tree; a successor commit and fresh exact-head CI/review are required. Protected main remains `4bb02f4655044122a95e3dbb94bba65844c0f0cb`.

Safety remains:

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `aiAuthority=ZERO_AUTHORITY`
- `VERIFIED=false`

## Latest continuation — review repair on 2026-10-25

PR #2878 exact head `c20ddbad1e220cc40c47e49ecc30b6cbe325cc17` completed CI and all required companion workflows successfully. Fresh Codex review on that exact SHA found six P1s: strategy source fingerprints were not checked against captured bytes; blank instrument/data entries normalized to empty strings; Research Intelligence discovery time was not reconciled to the news observation; strategy/news precommits could predate evidence; dataset/PIT/OOS/fee/slippage plans could be empty; and no attributable replication outcome receipt existed.

The successor local repair now:

- requires a bounded captured public strategy source snapshot and verifies its SHA-256;
- rejects blank instruments/data requirements;
- binds Research Intelligence `discoveredAt` to the news observation's first-observed time and retrieval chronology;
- rejects precommit timestamps earlier than source observation/retrieval;
- requires dataset identity, explicit PIT and OOS plans, and fee and slippage model/assumption bindings;
- adds an immutable fingerprinted replication receipt bound to strategy, precommit, dataset identity, evaluator version/source SHA, result evidence, and negative evidence.

Successor local validation: focused intake tests 11/11; Node 24.19 `preflight`; typecheck/build; `validate:full`; `security:gate`; lint (45 warnings, 0 errors); `git diff --check`; and full `pnpm test` (1,281 isolated test files) all PASS. These results are on the local successor tree only. The current remote PR head remains `c20ddbad…`; its prior CI/review do not validate the repair. Next: commit/push once, then require fresh exact-head CI and fresh non-author review. Formal Validator, Audit/Release, production Scout composition, persisted result consumption, and natural Research/PAPER outcome remain outstanding. Oracle backup/deployment lane remains independent; no host mutation was performed here.
