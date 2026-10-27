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


An additional trust-boundary pass found the receipt producer must verify the canonical `ResearchPrecommit` fingerprint, not only its SHA shape. The producer now invokes `verifyResearchPrecommit`; a forged-fingerprint regression proves rejection.

The exact-head CI and required companions on `d07af20750787fa937cdae7ae2339c9e42a1f3aa` passed (CI run `40187825019`). Fresh Codex review on that head found three P1s: `sourceObservedAt` was not part of the strategy identity; precommit validation accepted boolean placeholders such as `{pit:true,oos:true}`; and a cloned Research Intelligence record with `publishedAt="UNKNOWN"` could evade timestamp chronology checks. The current local successor binds observation time into strategy identity, requires structured dataset/PIT/OOS/cost bindings, and reconstructs the Research Intelligence record through its canonical factory before checking publication/discovery times and chronology. Regression tests cover each finding.

Local validation on this unpushed successor: focused intake tests 11/11, Node 24.19 `preflight`, build/typecheck, `validate:full`, `security:gate`, lint (45 existing warnings, 0 errors), `git diff --check`, and full `pnpm test` (1,281 isolated test files) all PASS. These results are local only and do not validate a GitHub head. The latest remote PR head remains `d07af20750787fa937cdae7ae2339c9e42a1f3aa`; its prior CI/review become historical after publishing the repair. Next: publish the validated code/AIPOS update once, then require fresh exact-head CI and fresh non-author review. Formal Validator, Audit/Release, production Scout composition, persisted result consumption, and natural Research/PAPER outcome remain outstanding. Oracle backup/deployment lane remains independent; no host mutation was performed here.

## Latest continuation — expanded exact-head review repair on 2026-10-25

Fresh repository/GitHub state: protected main `4bb02f4655044122a95e3dbb94bba65844c0f0cb`; PR #2878 remains OPEN/Draft/mergeable at head `f54e978dabf967c741ffba05ddbf02d68b2a9e1a`. Its exact-head CI `40188921438` and required companion workflows pass. The exact-head Codex review found additional P1s covering same-source recapture deduplication, PIT/OOS window overlap, latency/missing-data assumptions, adapter-produced precommit attribution, receipt structural validation, canonical Research Intelligence rebinding, and source snapshot verification at news binding.

The current unpushed local successor now:

- keeps strategy identity stable across repeated captures of the same canonical source snapshot and rules, while retaining a separate source-observation fingerprint inside each immutable precommit;
- rejects overlapping or malformed explicit PIT/OOS windows and requires non-UNKNOWN latency and missing-data policies;
- verifies replication receipts came from the canonical strategy adapter precommit and revalidates their structural fields before trusting the fingerprint;
- requires news precommit to rebind through the canonical Research Intelligence record and re-hashes the exact captured snapshot at that trust boundary.

Final local checks on the complete successor all PASS: focused intake tests 11/11; build; typecheck; Node 24.19 preflight; `validate:full`; `security:gate`; lint (45 existing warnings, 0 errors); `pnpm test` (1,281 isolated files); and `git diff --check`. The final full run included the snapshot re-hash regression. No source has been pushed yet; generated docs/audits outputs remain excluded.

P0 tracks remain separate: exact-main Oracle release run `40178950069` is still in the persistent-state backup job, so no manual host action is being overlapped; #2589 still awaits genuine exact-main runtime restart/replay evidence after the #2770 release. No runtime cycle, performance, Scout production wiring, or PAPER strategy acceptance is claimed here.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review follow-up — recapture, intake prototypes, and experiment identity, 2026-10-27

Fresh review on PR #2878 head `e630650b9be3c8129a6661dc7fd35e7800d03e9a` found three further findings: a repeat capture could downgrade any durable novelty/lineage to the caller's new classification, inherited crypto-news taxonomy or precommit-plan fields could pass validation although object spread/JSON serialization drops them, and the news precommit experiment identity omitted source SHA and validation policy identity.

The SQLite repository now preserves the stored novelty, related-record lineage, and AXIOM handoff status for every authenticated recapture in both append and read paths. Crypto-news intake requires an ordinary/null-prototype object with own source/event/confidence fields; plan validation requires canonical JSON and checks only own fields. Crypto-news experiment identity now includes `sourceSha` and `validationPolicyIdentity`. Tests exercise repeated NEW capture, inherited taxonomy/plan fields, and identity changes on source/policy variation.

Focused compile of changed contract/storage files PASS; focused contract and storage suite 27/27 PASS; AIPOS YAML (521 files), work-order provenance, and `git diff --check` PASS. Full repository build/typecheck is not yet established: pre-existing local `node_modules` is incomplete (missing TypeScript and several type/runtime packages), so a temporary compiler was used for changed-file compile. Exact-head CI and fresh non-author review remain required. AIPOS state records the current local validation; successor head must be revalidated after push. Formal Validator remains separate; no Audit/Release/merge/Oracle action is claimed.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repairs — exact parent persistence and canonical input identity, 2026-10-26

The PR review of predecessor `088a3b9a18cdd68eae983ecb94d9961317df9853` found three remaining boundary gaps: a variant could embed a later equivalent but unpersisted parent precommit; the adapter verifier accepted a modified `regimePlan` after the public fingerprint was recomputed; and crypto-news observation identity included unknown runtime string or symbol keys that the canonical stored projection later drops.

The local successor requires the variant's exact parent fingerprint and canonical serialized precommit to resolve to the persisted original, requires the strategy adapter's canonical empty regime plan, and rejects unknown own keys before news identity construction. Adversarial tests cover alternate same-identity parents, fingerprint-recomputed regime plans, and unknown observation fields. The successor is based on newly fetched PR head `7253e3a4bd1540524a1d0bf939c6dde3554a5a01`, which independently added durable duplicate-classification preservation on both append and read; that remote implementation was retained rather than overwritten.

Local validation after rebase: 35 focused contract/storage tests, build, typecheck, Node 24.18 preflight, `validate:full`, `security:gate`, lint (45 existing warnings, zero errors), full `pnpm test` (1,284 isolated test files), AIPOS YAML/drift/conformance, and `git diff --check` passed. The initial Electron 42.11.18 download timeout was resolved by installing the official release; no tests were skipped. Exact-head CI and independent review for the eventual successor remain pending. This work remains a code/evidence pass only; no formal NUSA Validator, Audit, Release, merge, Oracle/runtime mutation, strategy-profitability claim, or PAPER/LIVE authority increase.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — optional StrategySpec metadata + channel identity, 2026-10-25

PR #2878 exact head `33b89e1952c1d819e9765bb5e85f2c99634a70d2` had exact-head CI and required companions PASS. Fresh Codex review `5643319844` found one P1: deserialized optional StrategySpec metadata such as `sourceCodeAvailable: "MAYBE"`, object-valued `publicationDate`, malformed lists, or non-record external performance could pass through normalization during precommit reconstruction. It also found one P2: `transmissionChannels` were validated as strings but not normalized, allowing semantically equivalent inputs to produce different observation identities.

The local successor validates optional scalar text, the source-code enum, optional evidence arrays, and reported-performance record shape before constructing a spec; it trims/deduplicates/sorts metadata arrays and transmission channels. Regressions recompute public identities around malformed StrategySpec metadata and verify deterministic channel identity.

Local checks on this successor: Node 24.19 `pnpm run preflight`; focused intake 13/13; build; typecheck; `validate:full`; `security:gate`; lint (45 existing warnings, zero errors); `pnpm test` (1,281 isolated test files); and `git diff --check` PASS. Current successor is not yet published; exact-head CI and a fresh non-author review are required after push. Formal NUSA Validator, Audit/Release, production Scout/store wiring, durable result consumption, and genuine Research/PAPER outcome remain outstanding. Oracle remains untouched; generated `docs/audits/*` outputs are excluded.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — optional news scalar trust boundary, 2026-10-25

Fresh Codex review of exact head `0a3b3eb76d1eb11c72d3a793fc2a84f3ae8dc76c` completed as review `5643254473` and found one P1: malformed optional fields such as numeric `syndicationClusterId` or object-valued `expectedDirection` were copied through the observation factory, so callers could recompute the public identity and still reach PIT binding. The local successor now rejects non-text/blank values for all optional scalar text fields (`originalPublisher`, `syndicationClusterId`, `expectedDirection`, `expectedMagnitude`, `expectedHorizon`) and normalizes valid optional strings before identity generation. Regression coverage includes forged/recomputed identity rejection for malformed cluster and direction fields and stable identity across whitespace normalization.

Validation on the local successor: Node 24.19 `pnpm run preflight`, focused Research intake tests 13/13, `pnpm run build`, `pnpm run typecheck`, `pnpm run validate:full`, `pnpm run security:gate`, `pnpm run lint` (45 existing warnings, 0 errors), `pnpm test` (1,281 isolated test files), and `git diff --check` all PASS. AIPOS drift and provenance checks also PASS after recording this finding. Exact-head CI and fresh review for the successor are pending; no formal NUSA Validator, Audit/Release, merge, production Scout/store wiring, or genuine Research/PAPER outcome is claimed. Generated `docs/audits/*` artifacts remain excluded. Oracle state was only read; no deployment, restart, or DB mutation occurred.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — 2026-10-25

On exact head `eb1a16ea5f615a2228e383d30f9eb041892a217c`, fresh Codex review found two additional P1 trust-boundary gaps: a deserialized StrategySpec could have required rules/lists changed and its public strategy identity recomputed before precommit admission; a deserialized crypto-news observation could similarly recompute its identity after changing taxonomy/confidence/evidence arrays and still reach PIT binding.

The local successor re-runs the canonical strategy normalization factory and compares the normalized value at precommit admission. News binding reconstructs the observation through the canonical factory, checks normalized source fields and the exact unbound or bound identity/status shape, then retains the existing Research Intelligence and source snapshot checks. Regressions recompute identities for empty instruments, blank exit rules, invalid event/confidence enums, and blank facts before asserting rejection.

Validation on this local successor: focused intake 13/13; Node 24.19 preflight; build; typecheck; `validate:full`; `security:gate`; lint (45 existing warnings, zero errors); `git diff --check`; full `pnpm test` (1,281 isolated test files) PASS. These local results do not bind to a remote SHA. Next: publish once on existing PR #2878, then obtain exact-head CI and fresh non-author review. Formal NUSA Validator, Audit/Release, production Scout composition, durable result consumption, and real Research/PAPER outcome remain outstanding. Oracle remains unchanged; latest read-only observation at 2026-10-25T12:35Z had runtime `c59b5224…`, healthy service, 45G root filesystem 94% used / 2.7G free, 68 realized periods, zero learning cycles, and missing sealed dataset manifest.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — timestamp, cost, and receipt canonicalization, 2026-10-25

Fresh non-author Codex review on PR #2878 head `72bb17b87ccdc952a8f44e727b975ea5716b05bc` identified two P1 findings and one P2: numeric/noncanonical provenance timestamps could reach PIT chronology, placeholder fee/slippage text could satisfy a precommit cost gate, and evidence records containing `undefined` values could canonicalize into incomplete receipts. The current successor now accepts only timezone-bearing ISO timestamps at provenance/precommit/receipt boundaries, rejects placeholder economic assumptions, and requires non-empty canonical JSON evidence records. The evidence guard rejects undefined/non-JSON values, sparse arrays, accessors, cycles, non-plain objects, symbols, and non-enumerable fields before fingerprinting. Regressions cover numeric and malformed timestamps, unknown costs, undefined/sparse/accessor evidence, and empty evidence.

Validation on the final local source: Node 24.19 `pnpm run preflight`; focused intake 14/14; build; typecheck; `validate:full`; `security:gate`; lint (45 existing warnings, zero errors); `pnpm test` (1,281 isolated files); and `git diff --check` PASS. Current PR head remains `72bb17b87ccdc952a8f44e727b975ea5716b05bc`; all prior CI/review receipts are predecessor evidence for this repair and must not be reused. The successor has not yet been committed/pushed; fresh exact-head workflows and fresh non-author review are required afterwards. Formal NUSA Validator, Audit/Release, merge, production Scout wiring, durable result consumption, and genuine Research/PAPER outcomes remain incomplete. Oracle remains untouched.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.


## Fresh exact-head review repair — persisted variant parent lineage, 2026-10-26

Fresh Codex review on PR #2878 head `0d43f3de0b8eb737d72a8630574f37a9d2d7f5cd` found a P1: a syntactically valid `variantOf` identity and caller-supplied parent spec could produce a variant precommit and receipt without proving that the original baseline existed in canonical storage. The repair binds the parent original precommit into the variant precommit, verifies its immutable original spec and PIT/OOS/cost plan, and makes the existing `SqliteResearchPrecommitRepository` resolve the exact persisted parent before storing a variant. Reads revalidate lineage so pre-existing orphan variant rows fail closed; no parallel store was added.

Regression coverage proves: (1) a caller-created original precommit cannot authorize a variant until the original is persisted, (2) the variant succeeds after the exact original precommit is stored, (3) legacy orphan rows are rejected on read, and (4) receipt creation rejects a variant with its parent removed even if the altered precommit fingerprint is recomputed. Node 24.19 preflight, build/typecheck, focused contract/storage tests 18/18, validate:full, security:gate, lint (45 warnings / 0 errors), and the full isolated suite (1,282 test files) passed. The final added receipt regression also passed focused tests and a build. Oracle remains untouched.

The source tree has not yet been committed; the `0d43f3de...` CI and review are historical for the successor. Next: recheck PR/base/head, update AIPOS validation history, publish one non-force commit, then exact-head CI and fresh non-author review. Formal Validator, Audit/Release, merge, production Scout composition, and genuine Research/PAPER outcomes remain incomplete.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.


Final storage-key integrity check — 2026-10-26

The canonical parent lookup also binds the SQLite row primary key to the stored original precommit fingerprint. A row containing a valid parent payload under a different key cannot establish variant lineage. A regression covers that malformed durable row. Final local validation was rerun: preflight, validate:full, security:gate, lint (45 existing warnings / 0 errors), build/typecheck, and all 1,282 isolated test files PASS; focused contracts/storage are 19/19 PASS. The b0f279ab GitHub runs do not include this final check and will not be reused.

## Fresh exact-head review repair — authenticated source capture, 2026-10-26

Fresh PR #2878 review on head `f4394b25bfda06f5807193eddeedcb70e234e4d7` found P1: caller-created Research Intelligence objects could set `VERIFIED_PRIMARY_SOURCE` / `SOURCE_VERIFIED`, and the SQLite store would persist the claim. The local successor now rejects trusted values in the public record factory; only the internal source verifier can mint a capability tied to a fetched canonical arXiv response and exact entry bytes. The SQLite append path requires that capability, and persisted reads validate the receipt and reconstruct the canonical record before allowing news PIT binding. Generic direct-source receipt minting is not enabled.

Final-source validation: Node 24.19 preflight, build/typecheck, validate:full, security:gate, lint (45 existing warnings / 0 errors), focused Research Intelligence/Scout/contract regressions 48/48, full `pnpm test` (1,282 isolated test files), and git diff check PASS. The initial full run exposed one stale contract fixture that asserted caller-supplied trusted taxonomy; the fixture now asserts rejection and the rerun passed. Current protected main remains `4bb02f4655044122a95e3dbb94bba65844c0f0cb`; current PR head `f4394b25...` is predecessor evidence only after the successor is published. Next: publish one non-force successor commit/push, exact-head CI, fresh non-author review, then separate formal Validator. No Audit/Release/merge or Oracle mutation. Oracle backup cancellation root cause remains UNKNOWN and no retry was issued.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — complete arXiv source-entry binding, 2026-10-26

Fresh Codex review on PR #2878 head `46eb5ef73ad7e7b7d2930461df712c91ae3c8f0c` found a P1: accepting a target paper ID substring from an authentic arXiv response did not bind caller-supplied title, publication time, or contribution metadata to the actual source entry. The repair requires the complete exact `<entry>...</entry>`, parses and validates the target identity, title, authors, publication time, summary/contribution, and discovery chronology against the authenticated capture, and binds a source-entry projection fingerprint into the verification receipt. Persisted record verification checks the same binding. Regression coverage rejects ID-only snippets and fabricated metadata while accepting the full matching entry.

Validation on the current local successor: focused Research Intelligence memory tests 6/6; Scout/attention-shadow tests 26/26; build; `validate:full`; `security:gate`; lint (45 existing warnings, zero errors); full `pnpm test` (1,284 isolated test files); and `git diff --check` PASS. Exact-head CI and fresh review for the successor remain pending. AIPOS state records this finding and next transition. No formal NUSA Validator, Audit/Release, merge, Oracle deployment/restart, or production evidence is claimed. The Oracle backup cancellation remains a separate unresolved infrastructure issue; no retry or mutation was performed.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Fresh exact-head review repair — capture timestamp and authentication carry boundary, 2026-10-26

Fresh Codex review on PR #2878 head `ab530a26d5171101ef201a737f9bc061c984ea53` found two P1s. First, the collector's injectable `now` callback could set `discoveredAt` earlier than the actual arXiv fetch; second, the generic authentication carry helper preserved the WeakSet capability when internal code changed `testableHypothesis`, its semantic fingerprint, relevance, evidence quality, assumptions, or required-data fields.

The successor now stamps `capturedAt` inside the canonical HTTPS fetch after reading the full response body. Receipt issuance requires `record.discoveredAt` to equal that opaque capture timestamp; the collector no longer accepts an injectable clock. Authentication carry compares every canonical record field and only permits novelty/related-record/handoff metadata deltas with valid deterministic forms. Regression tests cover a caller-provided 2020 clock, backdated receipt issuance, and changed interpretation fields with a recomputed semantic fingerprint.

Validation on the local successor: Node 24.19 preflight, typecheck, `validate:full`, `security:gate`, lint (45 existing warnings / 0 errors), build, focused Research Intelligence tests 34/34, full `pnpm test` (1,284 isolated test files), and `git diff --check` PASS. Exact-head CI and fresh non-author review for the successor remain pending. No formal NUSA Validator, Audit/Release, merge, or Oracle deployment/restart is claimed. Oracle backup cancellation remains unresolved; no retry or runtime mutation was performed.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

## Review follow-up — repeat-capture precommit deduplication, 2026-10-26

An additional review thread on predecessor `ab530a26d5171101ef201a737f9bc061c984ea53` identified that a repeated capture of identical source bytes/rules changed `sourceObservedAt` and `createdAt`, producing another ResearchPrecommit row with the same experiment identity. The local repair makes the experiment identity bind evaluator source SHA and validation policy, then makes the canonical SQLite repository reuse the earliest durable strategy precommit only when the execution-authority projection is identical; conflicting material projections fail closed. Capture provenance and the first immutable precommit are preserved; no history is rewritten.

Build and focused contract/storage regressions pass 21/21. Full local gates and successor exact-head CI/review are pending. Current pushed head `fdc4269faee64b5008950171c28e34a1d7c924f5` includes the preceding capture-clock/auth-carry repairs but not this additional dedup fix. Once full gates pass, publish one non-force successor and restart exact-head validation. Formal NUSA Validator remains separate; keep Draft and do not run Audit/Release/merge or Oracle mutation.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.

Final local validation for the repeat-capture dedup repair: Node 24.19 preflight, build/typecheck, focused contract/storage 22/22, `validate:full`, `security:gate`, lint (45 pre-existing warnings, 0 errors), full `pnpm test` (1,284 isolated test files), and `git diff --check` all passed. A non-force successor commit/push to PR #2878 is the next step; its CI and independent review must be fresh.

## Fresh exact-head review repair — durable duplicate relation preservation, 2026-10-26

Fresh review on PR #2878 head `088a3b9a18cdd68eae983ecb94d9961317df9853` identified a P1: a durable `DUPLICATE` Research Intelligence record could be recaptured with default `NEW` relation metadata. That fresh capture could restore in-process source trust and replace the durable duplicate classification/lineage in the current-process projection, risking a duplicate AXIOM handoff.

The canonical SQLite Research Intelligence repository now restores source authentication while preserving durable `DUPLICATE`, its `relatedExistingResearch` lineage, and `DUPLICATE_SUPPRESSED` status in both append and read resolution. The capture authenticates source bytes only; it cannot rewrite the prior relation decision. Regression coverage creates a durable duplicate, recaptures the same authenticated source with default `NEW`, and verifies the relation, lineage, trust binding, and no-handoff behavior remain intact.

Validation on the local successor: Node 24.19 preflight; build; focused Research Intelligence memory tests 10/10; typecheck; `validate:full`; `security:gate`; lint (45 existing warnings, zero errors); full `pnpm test` (1,284 isolated test files); `git diff --check`; AIPOS YAML and drift gates PASS. Remote PR head remains `088a3b9...` and protected main remains `235b9bb3...` at last fetch; successor exact-head CI and independent review are pending. Existing audit outputs in `docs/audits/*` were preserved and excluded. No Oracle deployment, restart, DB/lease mutation, Audit/Release/merge, or Formal Validator is claimed.

Safety remains `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, and `VERIFIED=false`.
