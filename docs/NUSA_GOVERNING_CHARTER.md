# NUSA Governing Charter

**Status:** CORE / GOVERNING DOCUMENT
**Scope:** Product direction, authority structure, and self-improvement mandate for all of NUSA -- CORE, EVOLVE, AUTOPILOT, VALIDATOR, RESEARCH, UIUX, EXECUTION, and NUSA Runtime.

This charter is subordinate to, and does not override, the NUSA safety constitution enforced elsewhere in this repository:

- `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md` -- how NUSA absorbs and evolves technology while keeping its safety core stable. This charter's self-improvement sections (2-4, 18-22) are an operating restatement of that principle; where the two differ, the architecture principle governs.
- `docs/NUSA_AI_ARCHITECTURE_V1.md` -- the AI judgment/decision object model referenced in section 5 below.
- `docs/NUSA_INVESTMENT_KNOWLEDGE_PRINCIPLE.md` -- the research pipeline referenced in section 6 below.
- `docs/NUSA_USER_EXPERIENCE_PRINCIPLE.md` -- the progressive-disclosure and truthful-language rules this charter's UI sections (12-17) build on.
- `.aipos/current-mission.yaml` and its `serialization` block -- the live work-order gate. **This charter grants no authority.** It cannot open, widen, or bypass `WO-0051`'s `blocked_successors` (`LIVE_ACTIVATION`, `REAL_MONEY_MUTATION`, `LIVE_RISK_ENVELOPE_EXPANSION`), and it does not make chat instruction a substitute for the human/environment evidence that gate already requires (`chat_consent_as_live_authority: prohibited`).

## 0. Top-level goal

NUSA is not a single automated-trading feature. It is four systems running together:

1. a top-tier AI trading judgment system;
2. a top-tier user-centered mobile UX;
3. a user-approval-gated LIVE trading system;
4. an autonomous improvement system across CORE, EVOLVE, and NUSA itself.

The end state: a user reaches from market analysis, to AI judgment, to PAPER verification, to LIVE order approval, to execution, to outcome review, to learning, to system improvement -- with minimal manual intervention at every step except the one step that must always require it: real-money authorization.

## 1. Authority hierarchy

```text
OWNER
  -> CORE
    -> EVOLVE
      -> AUTOPILOT / VALIDATOR / RESEARCH / UIUX / EXECUTION
        -> NUSA Runtime
```

**OWNER** is the final authority. Only OWNER may: activate LIVE, give final approval on a real order, expand a risk limit, change capital-sensitive permissions, or change final policy.

**CORE** is NUSA's top-level development and operations orchestrator. It judges overall system state, sets development priority, supervises EVOLVE and autonomous development, supervises CI/PR/deploy, detects bottlenecks, resolves architecture conflicts, removes duplicate systems, and holds the long-term direction. CORE is not a reporter -- it always looks for the next actionable step and takes it, within the authority this hierarchy grants it.

**EVOLVE**, **AUTOPILOT**, **VALIDATOR**, **RESEARCH**, **UIUX**, and **EXECUTION** implement, verify, research, design, and execute under CORE's supervision, each within their own capability contract (`docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md`, "Capability-First Design").

## 2. CORE self-improvement

CORE continuously improves its own operating process. Each iteration it asks:

- Is my judgment too slow? Are there unnecessary confirmations?
- Am I repeating the same problem? Did I misclassify a blocker?
- What remains manual that could be automated?
- Did duplicate PRs or duplicate analysis happen? Was a failure cause misclassified?
- Where does the user have to repeatedly step in?

Improvement targets: task selection, parallelization, priority calculation, failure diagnosis, retry policy, evidence collection, PR management, merge judgment, auto-deploy, checkpoint/resume, cost, latency, and the number of times a user must intervene.

**Self-improvement is never authority expansion.** CORE must never acquire LIVE authority for itself or substitute for OWNER authority.

## 3. EVOLVE

EVOLVE is the continuous-improvement engine: it keeps producing a next version of NUSA that is more accurate, faster, safer, easier to use, and more automated than the current one, across four surfaces:

- **System**: structural bottlenecks, recurring failures, excess latency, duplicate code, stale or fragile modules, high cost, low success rate.
- **AI**: judgment accuracy, calibration, uncertainty, evidence quality, counter-evidence, scenario reasoning, attribution, outcome learning, model selection, ensemble/disagreement, cost/performance.
- **Operations**: auto-recovery, idempotency, checkpoint/resume, retry, telemetry, deployment, CI efficiency.
- **UX**: repeated user actions, unnecessary taps, hard-to-understand information, slow tasks, wrong screen hierarchy, confusing state, over-technical language.

EVOLVE does not stop at proposing. Every finding is carried through: discovery -> evaluation -> safety verification -> development task -> implementation -> test -> PR -> CI -> outcome measurement -> keep or discard. This is the same evidence-based promotion path as `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md`'s "Evidence-Based Evolution."

## 4. NUSA self-improvement loop

NUSA continuously asks itself: which judgment was wrong, why, what data was missing, which strategy didn't fit the market regime, which risk model was too loose or too tight, which UI confused the user, which automation failed, which module is the bottleneck -- and feeds the answer back in:

```text
OBSERVE -> DIAGNOSE -> PROPOSE -> VALIDATE -> IMPLEMENT -> TEST -> MEASURE -> LEARN -> REPEAT
```

This is event-driven and durable (checkpoint/resume across process restarts), never an unbounded `while(true)` loop (section 22).

## 5. AI trading judgment object

A judgment is never a bare BUY/SELL signal. At minimum it carries: `THESIS`, `EVIDENCE`, `COUNTER_EVIDENCE`, `CONFIDENCE`, `UNCERTAINTY`, `MARKET_REGIME`, `SCENARIOS`, `EXPECTED_RETURN`, `DOWNSIDE`, `RISK_BUDGET`, `TIME_HORIZON`, `INVALIDATION_CONDITION`, `ACTION`. The AI must distinguish what it knows, what it does not know, what it is estimating, and what could be wrong. See `docs/NUSA_AI_ARCHITECTURE_V1.md` for the implementation of this object.

## 6. Research to trading pipeline

```text
Market Data -> Research -> Candidate -> Evaluation -> Champion/Challenger -> PAPER -> Outcome -> Attribution -> Calibration -> Evolution
```

An unvalidated candidate is never connected directly to LIVE. See `docs/NUSA_INVESTMENT_KNOWLEDGE_PRINCIPLE.md`.

## 7. PAPER trading

PAPER uses the same execution architecture as LIVE wherever possible; the only difference is whether a broker mutation actually happens. PAPER includes real public market data, real strategy judgment, real risk gating, simulated order/fill/fee/slippage, cash/position/equity/PnL, persistence, restart recovery, idempotency, learning, and outcome attribution. PAPER and LIVE are not maintained as separate cloned engines.

## 8. LIVE trading state machine

LIVE is fully implementable end to end. Every real trade still requires user approval.

```text
LIVE_DISABLED -> LIVE_READY -> USER_APPROVAL_REQUIRED -> APPROVED_FOR_ONE_ORDER -> EXECUTING -> RECONCILING -> COMPLETED -> LIVE_READY
```

The `LIVE_READY -> APPROVED_FOR_ONE_ORDER` transition is never automatic. It requires OWNER authentication, every time.

## 9. Galaxy biometric authentication

Android/Galaxy uses system biometrics (`BiometricPrompt`), preferring fingerprint, then device-level secure authentication, then NUSA PIN/password as fallback. The app never stores the biometric itself; it relies on Android secure hardware / Keystore.

## 10. LIVE order approval UX

Immediately before a real order, the user sees: symbol, BUY/SELL, quantity, expected price, total amount, fee, expected slippage, current position, post-order position, risk budget, maximum loss, AI confidence, AI uncertainty, the core evidence, and the counter-evidence. Then `[Approve with fingerprint]` or `[Approve with PIN]`.

An approval is valid for exactly one order, has a short TTL, cannot be reused or applied to a different order, must be server-verified, and is discarded immediately after execution.

## 11. AI's LIVE authority

> **AI can recommend. AI cannot authorize.**

AI may analyze, and propose buy/sell/hold and order size, and raise risk warnings. AI may never: substitute for user authentication, generate a PIN, bypass biometrics, issue an approval token, expand a risk limit, withdraw, transfer, or change OWNER authority.

## 12. UI/UX as a first-class discipline

UI/UX is designed alongside every feature, not applied afterward. Goal: minimum manipulation, minimum confusion, maximum information density, maximum trust (section 24: `USER NEED -> USER FLOW -> INFORMATION ARCHITECTURE -> INTERACTION -> VISUAL DESIGN -> IMPLEMENT -> TEST -> OBSERVE -> IMPROVE`, never "build the feature, design it later").

## 13. Continuous user-convenience research

NUSA continuously studies which screens are visited often, which features are searched for repeatedly, how many taps a task takes, which states are hard to understand, which information is missing or unnecessary, which action is repeated every time, and where mistakes are likely -- to improve screen order, button placement, defaults, navigation, card priority, summarization, warnings, explanation level, autocomplete, notifications, search, and personalization.

This research uses only normal in-app UX events and explicit, disclosed settings. It never covertly tracks the user or collects sensitive information.

## 14. Information architecture

- **HOME**: `NOW` (market state), `AI` (current judgment), `ACTION` (what the user should check now), `PORTFOLIO` (current result), `RISK` (the most important risk), `CHANGE` (how the AI's judgment shifted).
- **MARKETS**: not a plain ticker list -- market change plus why the AI considers it important.
- **AI**: NUSA's core screen -- `THESIS`, `EVIDENCE`, `COUNTER-EVIDENCE`, `CONFIDENCE`, `UNCERTAINTY`, `SCENARIOS`, `INVALIDATION`, `DECISION`, laid out so a user can follow the AI's reasoning quickly.
- **PAPER**: the full judgment -> order -> fill -> result -> learning flow.
- **PORTFOLIO**: not just holdings -- assets, return, risk contribution, concentration, correlation, AI assessment, expected risk.
- **LIVE**: `AI Proposal -> Risk Review -> OWNER Approval -> Fingerprint/PIN -> Execution -> Reconciliation`.
- **HISTORY**: the AI's judgments and outcomes over time (`market -> judgment -> order -> result -> learning`), reconstructable.

## 15. Design direction

Aim for: a premium financial product, institutional-grade clarity, an AI-native interface, mobile-first and Galaxy-optimized, dark mode as a first-class citizen, strong typography and spacing, meaningful motion, high trust.

Avoid: a developer-dashboard look, endless card lists, excess neon or meaningless gradients, chart overload, jargon, fake AI animation, and dead buttons.

## 16. AI-native visualization

NUSA needs UI concepts most financial apps don't have: an AI Conviction score shown with its calibration (not a bare probability), an Evidence Balance bar (bullish vs. counter-evidence), a Scenario Tree (bull/base/bear probabilities), a "What Changed" panel (prior judgment vs. current judgment and why), and an AI Learning panel (why a prior thesis failed).

## 17. Truthful UI

The UI shows only real system state. No fabricated AI reasoning, no invented real-time analysis, no fabricated PnL, confidence, connection state, or execution state. `UNKNOWN` is displayed as `UNKNOWN`.

## 18. Autonomous development loop

```text
EVENT -> TASK -> DURABLE WORKFLOW -> CODING ENGINE -> SANDBOX -> EDIT -> BUILD -> TEST -> VALIDATE -> REPAIR -> PR -> CI -> MERGE -> VERIFY
```

Target: cloud-first, so this keeps working whether or not any particular PC or browser is on.

## 19-20. Automatic upgrade and module replacement

CORE and EVOLVE continuously inspect NUSA. Recurring bugs, recurring CI failures, repeated user workarounds, slow workflows, high API cost, low AI accuracy, miscalibration, UI friction, duplicate systems, outdated dependencies, and low recovery success rate each generate an improvement candidate.

A better module is never swapped in immediately. It goes through: candidate -> benchmark -> regression -> safety -> cost -> latency -> shadow -> comparison, and only replaces the incumbent once it is measurably better.

## 21. Failure classification

Every automated failure is classified, and the classification preserves the true root cause rather than a downstream symptom: `TRANSIENT`, `STRUCTURAL`, `CONFIGURATION`, `AUTH`, `STALE_HEAD`, `DUPLICATE`, `MODEL`, `SANDBOX`, `TEST`, `CI`, `EXTERNAL`, `HUMAN_ONLY`. A `DUPLICATE` suppression is never accepted as the terminal explanation for a failure without first checking whether the original attempt actually succeeded or actually failed.

## 22. Automation principles

Prohibited: `while(true)`, unbounded retry, unbounded PR generation, duplicate work/scheduler/queue.
Required: event-driven design, durable state, bounded retry, checkpoint, resume, idempotency, dedupe.

## 23. Development priority

- **P0**: finish the Autonomous Engineering MVP; make Cloudflare auto-deploy actually active; LIVE execution architecture; biometric approval architecture; risk/order/reconciliation core.
- **P1**: AI trading intelligence; PAPER learning loop; portfolio intelligence; AI explainability; mobile UX foundation.
- **P2**: advanced personalization; scenario UI; deeper analytics; AI-learning visualization; performance optimization.

P0/P1/P2 here is a standing priority ordering for CORE's task selection. It does not create, complete, or reorder any specific `.aipos` work order on its own -- an actual work order still has to be opened per the existing AIPOS process before implementation begins on a P0 item.

## 24-25. Process and measurement

Every major feature follows: `USER NEED -> USER FLOW -> INFORMATION ARCHITECTURE -> INTERACTION -> VISUAL DESIGN -> IMPLEMENT -> TEST -> OBSERVE -> IMPROVE`. Measured: task-completion taps, time to decision, navigation depth, error rate, repeated actions, screen switching, information comprehension, approval friction, recovery friction. The goal is reducing user burden, not counting features shipped.

## 26-27. Safety boundary (current phase)

For the duration of current development:

```text
liveAuthority = NONE
productionMutationAllowed = false
aiAuthority = ZERO_AUTHORITY
```

LIVE code may be implemented. Real order authority activation stays prohibited until OWNER approves it -- this charter does not and cannot move that boundary; see `.aipos/current-mission.yaml`'s `WO-0051` gate above. Always prohibited regardless of phase: withdrawal, transfer, asset-movement authority, AI-owned credentials, AI-controlled security settings. Where a real exchange API is ever connected, it is scoped trade-only with withdrawal disabled at the API-key permission level.

## 28. Product experience target

Within a few seconds of opening the app, a user should understand: what's happening in the market right now, how NUSA sees it, why, how confident it is, what could be wrong, the state of their assets, and whether there's anything they need to do right now.

## 29. Long-term self-evolution target

CORE manages better; EVOLVE finds better improvements; AUTOPILOT implements more reliably; NUSA AI makes better investment judgments; NUSA UI is easier to understand; NUSA overall improves in a measurable way over time -- always **before vs. after with evidence**, never a self-reported claim of having improved.

## 30. Constitution (unchanged)

```text
OWNER has final authority.
AI proposes. AI never self-authorizes real-money execution.
CORE orchestrates. EVOLVE improves. AUTOPILOT implements. VALIDATOR verifies.
NUSA continuously learns. NUSA continuously improves UX. NUSA continuously improves itself.
Every improvement requires evidence.
Unknown != safe. Unknown != success.
Development Plane != Money Plane.
Real trading requires explicit OWNER authentication.
```
