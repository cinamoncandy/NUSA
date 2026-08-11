# NUSA User Access Approval Architecture

**Status:** REQUIRED / IMPLEMENTED FOUNDATION / GOVERNING  
**Scope:** Human user admission to NUSA applications and protected APIs.  
**Authority:** Interpreted under `NUSA_CANONICAL_ARCHITECTURE_V2.md`, the NUSA Core Architecture Principle, and the Safety Constitution.

## 1. Purpose

NUSA requires explicit operator approval before a newly authenticated ordinary user may use protected system capabilities.

Authentication and system-use approval are separate decisions:

- **Authentication** answers: who is this user?
- **Access approval** answers: is this authenticated user currently allowed to use NUSA?

A successful sign-in MUST NOT imply system-use approval.

## 2. Non-negotiable invariants

1. New ordinary users default to **not approved**.
2. An authenticated but unapproved user may access only the minimum surfaces required to display approval status, sign out, and perform explicitly allowed account-recovery/support actions.
3. Only an authorized human operator role may approve, reject/revoke, suspend, or restore user access.
4. A user may never approve their own access.
5. AI, agents, models, plugins, or automated research/evolution systems have **ZERO approval authority**.
6. Approval state is server-authoritative. Mobile/desktop clients may cache it only as non-authoritative presentation state.
7. Missing, stale, unknown, unverifiable, or unreachable approval state fails closed for protected use.
8. Rejection/revocation or suspension must invalidate protected use without requiring an application reinstall or local logout.
9. Every approval-state mutation must produce durable audit evidence identifying actor, target user, action, reason, time, previous state, and resulting state.
10. Application code may request or display approval state but may not locally override it.
11. Access approval does not grant trading authority. Existing Risk, Execution, Deployment, PAPER/LIVE, credential, and operator-command gates remain independently required.
12. Approval checks must apply server-side to protected APIs; hiding UI alone is never sufficient enforcement.

## 3. Canonical persisted state model

The authoritative persisted states are:

- `PENDING` — authenticated identity exists but operator approval has not been granted.
- `ACTIVE` — user is currently admitted to the approved NUSA usage scope.
- `REJECTED` — access is not admitted. This state represents either an initial denial or withdrawal of a previously active user's approval; audit history distinguishes those cases.
- `SUSPENDED` — previously usable access is temporarily disabled and may be restored.

`UNKNOWN`, missing state, or an unreadable record is treated as non-approved.

Canonical transition actions are:

- `APPROVE` -> `ACTIVE`
- `REJECT` -> `REJECTED`
- `SUSPEND` -> `SUSPENDED`
- `RESTORE` -> `ACTIVE`

The semantic distinction between **initial denial** and **revocation of prior approval** is derived from immutable transition evidence:

- `PENDING -> REJECTED` = initial denial;
- `ACTIVE -> REJECTED` = approval revoked;
- `SUSPENDED -> REJECTED` = suspended access permanently rejected/revoked.

This avoids duplicating non-admitted persisted states while preserving complete governance semantics in the audit history.

Transitions must be explicit, authenticated, authorized, audited, and policy-validated.

## 4. Plane and authority ownership

### Control / Release plane

Owns:

- authoritative approval policy;
- operator approval workflow;
- approval-state transition authorization;
- operator role/permission checks;
- suspension/rejection/revocation policy;
- approval audit requirements.

### Cross-cutting identity/security fabric

Owns:

- authenticated user identity;
- operator identity;
- session/token binding;
- authorization claims or server-side decision lookup;
- credential/session invalidation after suspension or rejection/revocation.

### Applications plane

May:

- authenticate users;
- show `PENDING`, `ACTIVE`, `REJECTED`, or `SUSPENDED` states;
- request the current server-authoritative access decision;
- provide an operator console only when the authenticated principal has the required operator permission.

May not:

- convert `SIGNED_IN` into `ACTIVE` locally;
- mint approval state;
- bypass server enforcement;
- persist an approval decision as permanent local authority.

## 5. Required request path

Protected user action:

`User -> Authentication -> Server-side Access Approval Gate -> Existing capability/policy gates -> Target capability`

For trading-related actions, access approval is only an outer admission gate. The existing chain remains mandatory, for example:

`ACTIVE User -> Authenticated Command -> Policy/Mode Gate -> Portfolio/Risk -> Execution Boundary`

Access approval must never replace Risk, Execution, Deployment Authority, or PAPER/LIVE promotion controls.

## 6. Operator workflow

Minimum governed workflow:

1. User authenticates or creates an account.
2. Server establishes `PENDING` as the default ordinary-user admission state.
3. Authorized operator reviews the user.
4. Operator chooses approve or reject and supplies required reason/evidence.
5. Server records an immutable/auditable transition.
6. On approval, subsequent protected requests may proceed to their normal capability-specific gates.
7. Operator may later suspend, restore, or reject/revoke access.
8. Suspension or rejection/revocation propagates to protected API enforcement and active-session policy.

The operator UI is not the authority; it is a client of the server-side approval authority.

## 7. Audit evidence

Each state mutation should record at minimum:

- decision/audit record ID;
- target `userId`;
- operator `actorId`;
- previous state;
- resulting state;
- action;
- reason where supplied/required;
- decision timestamp.

Future hardening may add policy/version and request/correlation identifiers, but existing append-oriented transition evidence must remain reconstructable.

## 8. Session and cache semantics

- Local clients must not treat cached `ACTIVE` as permanent authority.
- Protected requests must receive server-side enforcement even if UI state is stale.
- Approval-state caches require an explicit freshness policy.
- Failure to refresh a required decision must fail closed for protected use.
- Suspension or rejection/revocation should invalidate or constrain existing sessions according to server policy.
- Offline mode must not create new protected authority.

## 9. Scope evolution

Initial rollout may use one account-level `ACTIVE` state.

The contract should remain extensible to scoped grants such as:

- environment (`PAPER`, future approved environments);
- application/operator feature classes;
- organization/tenant;
- account or portfolio;
- expiration window;
- device/session risk requirements.

Adding scopes must not weaken default-deny behavior.

## 10. Authentication separation

The mobile authentication context may model session presentation such as:

`CHECKING | SIGNED_OUT | SIGNED_IN`

That remains an authentication/session model, not the access-admission authority.

Approval must remain a separate server-authoritative decision. Adding `ACTIVE` or any approval state as a locally mutable `AuthStatus` is forbidden.

## 11. Current implementation foundation

The merged server foundation provides:

- `OWNER` and `USER` roles;
- default `PENDING` ordinary-user registration;
- `PENDING | ACTIVE | REJECTED | SUSPENDED` persisted states;
- `APPROVE | REJECT | SUSPEND | RESTORE` actions;
- owner/operator authority checks;
- owner protection from ordinary user-approval mutation;
- in-memory and SQLite-backed registries;
- append-oriented access audit records;
- a server-side `isUserAllowed(...)` decision that admits only `ACTIVE`.

This is the authority foundation, not the complete end-state rollout.

## 12. Remaining implementation hardening

Before user-access approval is considered complete end-to-end, NUSA must prove:

- all protected APIs that require admitted user access enforce the server-side gate;
- sign-in alone cannot access protected capabilities;
- ordinary users cannot self-approve;
- AI/plugin code cannot approve users;
- only authorized operator principals can mutate approval state;
- stale/missing approval fails closed;
- suspension and rejection/revocation block protected use;
- client-side tampering cannot bypass server checks;
- active sessions cannot retain protected authority after a blocking transition beyond policy bounds;
- approval does not bypass Risk/Execution/Deployment/PAPER-LIVE gates;
- all approval mutations emit auditable evidence;
- operator and user UX represent the authoritative server state without creating local authority.

## 13. Completion rule

User access approval is complete only when server-side enforcement, operator authorization, audit evidence, rejection/revocation behavior, session propagation, client UX, and regression tests pass together.

A UI-only approval screen or a successful login is never implementation completion.