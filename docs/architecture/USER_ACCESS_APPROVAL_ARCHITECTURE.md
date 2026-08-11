# NUSA User Access Approval Architecture

**Status:** REQUIRED / PLANNED CONTROL-PLANE CAPABILITY  
**Scope:** Human user admission to NUSA applications and protected APIs.  
**Authority:** Interpreted under `NUSA_CANONICAL_ARCHITECTURE_V2.md`, the NUSA Core Architecture Principle, and the Safety Constitution.

## 1. Purpose

NUSA will require explicit operator approval before a newly authenticated user may use the system.

Authentication and system-use approval are separate decisions:

- **Authentication** answers: who is this user?
- **Access approval** answers: is this authenticated user currently allowed to use NUSA?

A successful sign-in MUST NOT imply system-use approval.

## 2. Non-negotiable invariants

1. New users default to **not approved**.
2. An authenticated but unapproved user may access only the minimum surfaces required to display approval status, sign out, and perform explicitly allowed account-recovery/support actions.
3. Only an authorized human operator role may approve, deny, suspend, restore, or revoke user access.
4. A user may never approve their own access.
5. AI, agents, models, plugins, or automated research/evolution systems have **ZERO approval authority**.
6. Approval state is server-authoritative. Mobile/desktop clients may cache it only as non-authoritative presentation state.
7. Missing, stale, unknown, unverifiable, or unreachable approval state fails closed for protected use.
8. Revocation or suspension must invalidate protected use without requiring an application reinstall or local logout.
9. Every approval-state mutation must produce durable audit evidence identifying actor, target user, action, reason, time, previous state, resulting state, and policy/version context.
10. Application code may request or display approval state but may not locally override it.
11. Access approval does not grant trading authority. Existing Risk, Execution, Deployment, PAPER/LIVE, credential, and operator-command gates remain independently required.
12. Approval checks must apply server-side to protected APIs; hiding UI alone is never sufficient enforcement.

## 3. Canonical state model

Recommended authoritative states:

- `PENDING` — authenticated identity exists but operator approval has not been granted.
- `APPROVED` — user is currently admitted to the approved NUSA usage scope.
- `DENIED` — operator explicitly rejected access.
- `SUSPENDED` — previously usable access is temporarily disabled.
- `REVOKED` — prior approval was withdrawn and must not silently reactivate.

`UNKNOWN` or missing state is treated as non-approved.

Transitions must be explicit, authenticated, authorized, audited, and policy-validated.

## 4. Plane and authority ownership

### Control / Release plane

Owns:

- authoritative approval policy;
- operator approval workflow;
- approval-state transition authorization;
- operator role/permission checks;
- suspension/revocation policy;
- approval audit requirements.

### Cross-cutting identity/security fabric

Owns:

- authenticated user identity;
- operator identity;
- session/token binding;
- authorization claims or server-side decision lookup;
- credential/session invalidation after suspension/revocation.

### Applications plane

May:

- authenticate users;
- show `PENDING`, `DENIED`, `SUSPENDED`, `REVOKED`, or approved UI states;
- request the current server-authoritative access decision;
- provide an operator console only when the authenticated principal has the required operator permission.

May not:

- convert `SIGNED_IN` into `APPROVED` locally;
- mint approval state;
- bypass server enforcement;
- persist an approval decision as a permanent local authority.

## 5. Required request path

Protected user action:

`User -> Authentication -> Server-side Access Approval Gate -> Existing capability/policy gates -> Target capability`

For trading-related actions, access approval is only an outer admission gate. The existing chain remains mandatory, for example:

`Approved User -> Authenticated Command -> Policy/Mode Gate -> Portfolio/Risk -> Execution Boundary`

Access approval must never replace Risk, Execution, Deployment Authority, or PAPER/LIVE promotion controls.

## 6. Operator workflow

Minimum governed workflow:

1. User authenticates or creates an account.
2. Server establishes `PENDING` as the default admission state.
3. Authorized operator reviews the user.
4. Operator chooses approve or deny and supplies required reason/evidence.
5. Server records an immutable/auditable transition.
6. On approval, subsequent protected requests may proceed to their normal capability-specific gates.
7. Operator may later suspend or revoke access.
8. Suspension/revocation propagates to protected API enforcement and active-session policy.

The operator UI is not the authority; it is a client of the server-side approval authority.

## 7. Audit evidence

Each state mutation should record at minimum:

- `decisionId`;
- target `userId`;
- operator `actorId`;
- operator role/permission evidence;
- previous state;
- resulting state;
- reason;
- decision timestamp;
- policy/version identifier;
- request/correlation identifier;
- optional expiration/scope where policy supports it.

Approval evidence must be append-oriented and reconstructable.

## 8. Session and cache semantics

- Local clients must not treat cached `APPROVED` as permanent authority.
- Protected requests must receive server-side enforcement even if UI state is stale.
- Approval-state caches require an explicit freshness policy.
- Failure to refresh a required decision must fail closed for protected use.
- Suspension/revocation should invalidate or constrain existing sessions according to server policy.
- Offline mode must not create new protected authority.

## 9. Scope evolution

Initial rollout may use one account-level `APPROVED` state.

The contract should remain extensible to scoped grants such as:

- environment (`PAPER`, future approved environments);
- application/operator feature classes;
- organization/tenant;
- account or portfolio;
- expiration window;
- device/session risk requirements.

Adding scopes must not weaken default-deny behavior.

## 10. Current repository gap

The current mobile auth context models only:

`CHECKING | SIGNED_OUT | SIGNED_IN`

That is an authentication/session presentation model, not a complete access-admission model.

Before this feature is considered implemented, NUSA must add a separate server-authoritative access decision rather than simply adding `APPROVED` as a locally mutable mobile flag.

## 11. Implementation migration

### Phase A — Contract

- define user access decision and transition contracts;
- define operator role/permission contract;
- define audit evidence schema;
- define server-side default-deny semantics.

### Phase B — Server authority

- persist authoritative approval state;
- implement authenticated operator transition endpoints/services;
- enforce approval on protected APIs;
- implement session/revocation propagation.

### Phase C — Applications

- add pending/denied/suspended/revoked states to user UX;
- add approved-use transition only after server decision;
- build operator approval console as a non-sovereign application surface.

### Phase D — Guard tests

Automated tests must prove:

- sign-in alone cannot access protected APIs;
- new users default to pending/non-approved;
- ordinary users cannot self-approve;
- AI/plugin code cannot approve users;
- only authorized operator principals can mutate approval state;
- stale/missing approval fails closed;
- suspension/revocation blocks protected use;
- client-side tampering cannot bypass server checks;
- approval does not bypass Risk/Execution/Deployment/PAPER-LIVE gates;
- all approval mutations emit auditable evidence.

## 12. Completion rule

User access approval is complete only when server-side enforcement, operator authorization, audit evidence, revocation behavior, client UX, and regression tests all pass together.

A UI-only approval screen is not implementation completion.
