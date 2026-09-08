# ADR-0018: Upbit bridge credential persistence

## Status

Accepted, on the owner's explicit decision. Supersedes the process-memory-only
choice previously asserted by `tests/mobile-upbit-readonly-bridge.test.js`.

## Context

`apps/mobile/src/upbitCredentialSession.ts` held the personal Upbit bridge
credential in a module-level variable and nowhere else, documented as
"Process-memory-only". Android reclaims a backgrounded process freely, so the
credential was gone on the next launch: `isConfigured()` returned false,
`refreshUpbitReadOnlyAccount` short-circuited with "Upbit bridge credential is
not configured", and the panel fell back to disconnected.

The owner reported this as the READ_ONLY connection authenticating successfully
and then "coming undone" by itself. That is exactly the described behavior — the
connection was never revoked, its credential simply did not outlive the process.

The approved PAPER session already persists a rotating refresh credential through
a platform secure storage port (`SecureStoragePort`, backed by the Android
Keystore via `NusaSecureStorage`). The Upbit bridge credential was the only
device credential with no persistence at all, which made the READ_ONLY surface
unusable in practice rather than more secure in practice: the owner had to
re-enter the credential on every launch.

## Decision

1. Persist the Upbit bridge credential through the same `SecureStoragePort` the
   approved PAPER session uses, under `nusa.mobile.upbit-bridge-credential.v1`.
   Never AsyncStorage, never a plaintext file, and never the Upbit API keys
   themselves — those stay server-side and are not present in the app at all.
2. `credentialProvider()` restores from secure storage when process memory is
   empty, so a relaunch reattaches the existing connection.
3. `clearUpbitCredentialSession()` deletes the stored secret as well as memory. An
   explicit disconnect must not leave a credential the next launch would silently
   reconnect with.
4. Persistence is best effort. A runtime without secure storage still connects for
   that session rather than refusing the credential, and a corrupt stored record is
   discarded rather than retried on every read.
5. Add `restoreUpbitReadOnlyAccount()` and call it once at app start. The
   credential now outlives the process but the module's base URL and refresh timer
   do not, so without this the restored credential would sit unused and the panel
   would still report "not configured".

## Safety invariants

- `liveAuthority=NONE`, `productionMutationAllowed=false`, AI remains
  `ZERO_AUTHORITY`.
- The credential authorizes READ_ONLY Upbit observation through the approved
  relay. It carries no order, cancel, transfer, or withdrawal authority, and this
  decision adds no route that could.
- `UPBIT_ACCESS_KEY` / `UPBIT_SECRET_KEY` remain server-side environment material
  and are still absent from the mobile app.
- The stored value is a bearer credential at rest on the device, protected by the
  platform keystore — the same posture already accepted for the PAPER refresh
  credential in the same store.

## Consequences

A connected READ_ONLY session survives a relaunch, which is what makes the
surface usable at all. The cost is a long-lived bearer credential at rest on the
device rather than one that dies with the process; that is the tradeoff the owner
chose, bounded by keystore protection, READ_ONLY scope, and an explicit
disconnect that erases it.
