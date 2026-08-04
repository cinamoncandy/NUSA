# Decision 0002 — Versioned Shared Monitor Read Contracts

Status: Accepted

Date: 2026-08-04

## Context

Desktop publishes a localhost-only Paper monitor consumed by Mobile. Its read payloads previously had duplicated DTOs and no shared runtime validation boundary. Mobile and a future Cloud reader can deploy independently, so contract evolution must not make a valid older reader unsafe or unusable.

## Decision

`packages/contracts/src/monitorRead.ts` owns the Monitor read contracts for status, account, portfolio, markets, candles, and orders. The Desktop bridge validates and serializes these contracts; Mobile validates the same contracts before rendering. Cloud receives no connection or runtime wiring in this decision, only the reusable contract module.

Every in-scope JSON response carries `contractVersion`, beginning with `1.0.0`. The version remains in the JSON payload rather than an HTTP header because the existing Mobile boundary consumes JSON bodies directly, and replayed or logged bodies retain their version and can be validated atomically with their fields.

## Compatibility policy

- Version strings use `MAJOR.MINOR.PATCH` SemVer.
- A v1 reader accepts any valid `1.x.y` response and ignores unknown additive fields.
- Unversioned legacy Desktop payloads are interpreted as `1.0.0` so independently deployed Mobile clients remain compatible.
- In v1, a field cannot be removed, renamed, narrowed, or change meaning. New fields must be additive and optional for existing v1 readers.
- A retired field remains in v1 and is documented with `@deprecated`, together with its replacement.
- Breaking changes are permitted only in a new v2 contract. v1 remains available to existing clients.
- Invalid SemVer, unsupported major versions, or invalid payload fields fail closed: Desktop returns no partial monitor body, and Mobile does not update view state.

## Safety consequences

This decision changes only the read boundary. It does not add endpoints, mutate orders, alter fills, change Paper accounting or Risk behavior, connect Cloud, or enable Live Trading.
