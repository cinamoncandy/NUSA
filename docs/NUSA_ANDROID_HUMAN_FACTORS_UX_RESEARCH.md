# NUSA Android Human-Factors UX Research

Status: research guidance for temporary Android design exploration. This document does **not** freeze the visual design.

## Product model

NUSA is not a conventional trading app. The Android client is a **supervisory investment intelligence interface**: the system observes and analyzes; the owner supervises, verifies, and decides. The interface therefore optimizes for situational awareness, appropriate reliance, evidence verification, authority clarity, and low-friction owner decisions rather than trade stimulation.

## Research synthesis

### 1. Situation awareness before dashboard density

Human-factors research on complex supervisory systems consistently frames good operator awareness as three capabilities:

1. perceive the relevant state,
2. understand what the state means,
3. project what is likely to happen next.

For NUSA this maps to:

- **NOW** — what changed and what needs attention,
- **MEANING** — why NUSA interprets it that way,
- **NEXT** — what happens if the owner acts, waits, or rejects the thesis.

A static wall of cards is therefore the wrong default. The home surface should be state-driven and promote the single most decision-relevant condition.

### 2. Confidence is not the hero

Human-AI studies show that confidence displays can improve decisions when confidence is well calibrated, but can also increase inappropriate reliance when calibration is poor. Explanations alone can likewise increase reliance without enabling users to detect wrong advice.

NUSA rule:

- never make a large percentage ring the primary persuasion device;
- show confidence only when calibration is verified;
- pair it with uncertainty, evidence quality, counter-evidence, data freshness, and model/run provenance;
- prioritize **verifiability** over persuasive explanation;
- provide a deliberate path to inspect the strongest counter-case before a consequential owner decision.

### 3. Trust must be calibrated, not maximized

The target is not “make the owner trust NUSA.” The target is **appropriate reliance**.

The interface should make it easy to know:

- what NUSA knows,
- what NUSA does not know,
- what could invalidate the current view,
- whether the data is fresh,
- whether the model output is calibrated,
- whether execution authority exists,
- what the owner must decide.

This implies a compact, always-visible **System Truth Rail** rather than repeated safety cards on every screen.

### 4. Reduce automation bias with active verification

High cognitive load and complex verification are associated with automation-bias errors. The UI should reduce verification cost rather than merely add more explanations.

Required interaction pattern for meaningful decisions:

1. NUSA thesis,
2. strongest supporting evidence,
3. strongest counter-evidence,
4. uncertainty / invalidation boundary when canonically available,
5. owner action.

For high-stakes or contradictory cases, a brief deliberation step is desirable; it must not become friction on routine, low-risk monitoring.

### 5. Financial UX must avoid engagement-for-engagement’s-sake

Investment apps can alter behavior through gamified prompts, excessive notifications, reward loops, and attention-grabbing visual treatment. NUSA should deliberately avoid this class of design.

Do not use:

- celebration/confetti for gains,
- streaks or badges for trading frequency,
- red/green animation that pressures immediate action,
- notification volume as engagement optimization,
- “hot” opportunity language without evidence quality,
- decorative pseudo-precision.

NUSA should reward **correct supervision**, not more trading.

### 6. Mobile investment research favors consistency and a useful first screen

Studies of mobile trading UX report recurring problems from excessive menus/buttons, inconsistent action locations, too many colors, insufficient terminology guidance, small controls, and first screens that do not surface useful information.

NUSA therefore needs:

- stable action locations,
- a very small semantic color set,
- 48dp minimum touch targets,
- one useful first screen rather than a generic dashboard,
- terms explained in context,
- progressive disclosure for expert detail.

### 7. Android is a variable-size environment, not one phone mockup

The UI must adapt to compact phones, large phones, foldables, tablets, landscape, and windowed modes. Android’s current guidance favors window-size-aware layouts, edge-to-edge rendering with correct insets, adaptive navigation, predictive back, accessible semantics, and at least 48dp interactive targets.

NUSA validation must include:

- compact portrait,
- large/XL width,
- landscape,
- 200% font scaling,
- TalkBack heading/navigation semantics,
- gesture and three-button navigation,
- display cutouts,
- predictive back,
- one-handed use on Galaxy-class devices.

## Current temporary design: research-driven gaps

The current Android reference implementation is a strong visual exploration but should not yet be treated as the final UX.

### Gap A — confidence is too visually dominant

A large confidence ring can become an anchoring cue. Confidence should become a supporting reliability signal, not the central visual object.

### Gap B — home is still a stacked dashboard

Asset state, performance, decision, risk/authority, capital control, actions, and connectivity are vertically stacked. That creates unnecessary scroll and forces the owner to synthesize priority manually.

### Gap C — safety truth is duplicated

`PAPER ONLY`, `LIVE NONE`, and `AI ZERO AUTHORITY` are essential but should live in one persistent truth rail and expand on demand. Repetition consumes attention that should belong to state changes and evidence.

### Gap D — risk placeholder has low information value

When a canonical risk score does not exist, a large “risk score unavailable” area should not occupy prime visual space. Show the actual available constraints and elevate the missing capability only when it blocks a decision.

### Gap E — AI page reads like a report, not a decision workspace

Evidence and counter-evidence are present, but the user should be able to compare them spatially and quickly determine **what would change the decision**.

### Gap F — static information hierarchy

The same layout is shown regardless of whether the system is disconnected, idle, evaluating, holding a position, facing a risk breach, or waiting for owner review. NUSA should change emphasis according to operating state.

## Proposed NUSA mobile information architecture

Keep primary navigation stable and small:

1. **NOW** — current operating state and one highest-priority owner question
2. **MARKETS** — opportunities and market context, ranked by evidence not excitement
3. **NUSA** — decision workspace: thesis, evidence, counter-case, uncertainty, owner decision
4. **ASSETS** — portfolio, exposure, PnL, capital allocation
5. **CONTROL** — risk, authority, connection, settings, audit/provenance

Trading is contextual to a verified market/decision flow and should not be a primary navigation destination merely because conventional trading apps do so.

## Screen model: six layers

### Layer 0 — System Truth Rail
Always compact, always truthful:

- mode,
- data freshness,
- connectivity,
- authority,
- critical risk gate.

Only abnormal state expands automatically.

### Layer 1 — Situation
One sentence answering: **What matters now?**

### Layer 2 — Meaning
Why this matters to the portfolio or objective.

### Layer 3 — Evidence
Support, counter-evidence, source freshness, provenance, uncertainty.

### Layer 4 — Decision
The one owner decision currently available, including “do nothing.”

### Layer 5 — Consequence
What changes if the owner accepts, rejects, or waits.

### Layer 6 — Learning / History
What NUSA learned, what changed since the previous decision, and whether calibration/performance improved. This is secondary to the current decision.

## State-driven Home behavior

The first screen should re-rank itself according to state:

- **Disconnected / stale** → connection and freshness first; suppress misleading decision prominence.
- **No urgent condition** → asset health + concise operating summary.
- **New verified opportunity** → opportunity + evidence quality + owner review action.
- **Open position** → thesis health + invalidation/risk + position consequence.
- **Pending order** → order state + cancel/review, not a new opportunity.
- **Risk breach / safety gate** → risk condition first; other content visually recedes.
- **AI unavailable** → market/asset truth remains usable; no empty AI theatre.

## Visual principles for the next mockups

- premium editorial restraint, not sci-fi decoration;
- large whitespace only where it increases hierarchy;
- one accent family for ordinary information;
- amber/red reserved for real state semantics;
- no decorative orb/hologram unless it encodes real information;
- no hero chart unless it answers the current owner question;
- numbers use tabular alignment;
- typography distinguishes judgment, evidence, and system metadata;
- motion communicates state transition, never excitement;
- unknown/unavailable is visually calm rather than alarm-like unless it blocks safe operation.

## Convenience targets

The next prototype should be evaluated against concrete targets:

- owner understands current system state within ~3 seconds;
- owner can answer “what changed?” without scrolling;
- owner can reach the current primary decision in <=2 meaningful taps;
- owner can inspect the strongest counter-evidence in <=1 tap from a decision;
- safety/authority state is always discoverable without dominating normal operation;
- no primary interaction target below 48dp;
- no critical information encoded by color alone;
- 200% font scaling does not hide the primary decision;
- back behavior is predictable;
- abnormal alerts are prioritized and actionable rather than chronologically noisy.

## Research-informed design thesis

> NUSA should feel less like a trading dashboard and more like a quiet, high-integrity supervisory instrument that continuously answers: what changed, what does it mean, what evidence supports it, what could make it wrong, and what does the owner need to decide now?

The visual design remains temporary until user review confirms a direction. These human-factors rules are more stable than any single visual style and should constrain all future Android concepts.

## Evidence base consulted

- Android Developers: Material 3 Adaptive, adaptive navigation, edge-to-edge, predictive back, accessibility semantics, 48dp minimum touch targets, font scaling.
- ACM Journal on Responsible Computing (2024): systematic review of appropriate trust in human-AI interaction.
- CHI 2024: human self-confidence calibration and appropriate reliance in AI-assisted decisions.
- AI & Society (2025/2026): systematic review of automation bias in human-AI collaboration.
- AAAI 2026: effects of calibrated vs. miscalibrated AI confidence on reliance and decision accuracy.
- AI Magazine (2024): explanations are useful when they enable verification rather than merely interpretation.
- SEC / FINRA: risks and behavioral effects of digital engagement practices and gamification in investment platforms.
- Human Factors / Ecological Interface Design literature: situation awareness and supervisory control in complex real-time systems.
- Korean MTS usability research: consistency, menu overload, color overload, terminology guidance, useful first-screen information, control visibility.
- 2025–2026 robo-advisor research: trust, interpretability, uncertainty reduction, personalization, and investor-type-dependent communication.
