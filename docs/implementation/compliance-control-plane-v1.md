# Compliance Control Plane v1

This is a standalone, event-sourced compliance domain. It does not call a trading engine, issue execution authorization, hold credentials, or submit an exchange order.

## Fail-closed decisions

Rules are immutable `(ruleId, version)` records. Every evaluation references the exact rule version and evidence references. Missing rules or an unknown party result in `UNKNOWN`; callers must treat `UNKNOWN` as non-permissive. Restricted instruments and sanctioned parties are `BLOCK`; restricted parties or incomplete evidence require review.

## Immutable assurance record

Decisions, surveillance alerts, cases, evidence attachments, report generation, and certifications use a SHA-256 append-only chain. Replay checks sequence, predecessor hashes, timestamps, decisions, and the rule-version/evidence contract. A case cannot close until evidence is attached. Regulatory reports contain replayed event hashes and a deterministic report hash.

## Surveillance boundary

The initial deterministic rules consume immutable observations only. They identify self/common-owner fills as wash-trading alerts and a bounded cancellation threshold as excessive-cancellation alerts. They create alerts; they never alter an order, risk decision, or execution authorization.

## Persistence

Migration `004_compliance_control_plane` creates append-only events, snapshot hash, and disposable projection tables. The SQLite store appends an event and its snapshot hash atomically, then verifies state by replay. A projection/dashboard is never authority.

## Scope

This is PAPER-safe infrastructure for future review workflows. It is not regulatory advice, does not establish a live-trading capability, and does not satisfy regulatory reporting obligations without jurisdiction-specific legal and operational review.
