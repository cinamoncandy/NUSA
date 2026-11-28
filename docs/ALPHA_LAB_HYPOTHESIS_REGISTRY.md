# Alpha Lab hypothesis registry (A1)

Status: **offline registry implementation; no hypothesis has been registered by this change.**

The registry gives each prospective hypothesis a stable ID, a canonical specification hash, a fixed family K slot, and an append-only sequence of data-access, result, and verdict events. It is recordkeeping only. It does not fetch or inspect market data, decide whether a result is a winner, admit a candidate, or authorize PAPER or live behavior.

## Frozen specification

The specification is JSON with this shape (values are illustrative, not accepted limits or defaults):

```json
{
  "dataPlan": { "source": "public daily candles", "span": "predeclared UTC interval", "universe": "fixed cohort" },
  "decisionRule": { "reference": "the reviewed rule text" },
  "hypothesis": "A predeclared signal predicts a predeclared forward outcome.",
  "metric": { "name": "the registered statistic" },
  "rationale": "Why this test is being proposed.",
  "schemaVersion": 1,
  "sources": ["docs/RESEARCH_SOURCE.md#section" ]
}
```

Use `canonicalize-spec --spec draft.json` to print the sorted, compact JSON representation. Inspect that output, save it as the frozen spec, and only then register it. Registration rejects a noncanonical file; its SHA-256 covers the canonical JSON bytes including the final LF. Duplicate JSON keys are not valid frozen input: the canonical output shows the parsed object and must be inspected before registration.

Every registration explicitly supplies `familyId`, `kIndex`, and `kTotal`; `kTotal` is fixed for the family and a slot can be occupied only once. **Data access is blocked until all K slots in that family have registrations**, so the family membership cannot be extended after its first logged data access. No program alpha, family K, threshold, or risk setting is supplied by the tool. Exact duplicate specification hashes are rejected globally. A semantically revised hypothesis must be declared `REVISION`, link the earlier ID, and use a new slot, so it consumes a place in the fixed K. That relation is an author assertion; reviewers still check for unlinked near-duplicates.

The `register` command requires `--confirm-no-prior-data-access`. This records the registrant's statement and the system clock timestamp; neither proves that data was unseen. The data-access marker must be appended before the caller reads the registered data. The marker command itself performs no read. Historical hypotheses/results are not imported or relabeled as preregistered by this work order.

## Local commands

The default ledger path is `docs/research-data/alpha-lab/hypothesis-registry.jsonl`. No file is created until a registration/event is appended. Tests always use a temporary path.

```text
node scripts/alpha-lab/hypothesis-registry.js validate
node scripts/alpha-lab/hypothesis-registry.js list
node scripts/alpha-lab/hypothesis-registry.js canonicalize-spec --spec draft.json
node scripts/alpha-lab/hypothesis-registry.js register \
  --id momentum-2027-01 --family momentum-2027 --k-index 1 --k-total 3 \
  --relation new --spec frozen.json --confirm-no-prior-data-access
node scripts/alpha-lab/hypothesis-registry.js data-started --id momentum-2027-01
node scripts/alpha-lab/hypothesis-registry.js result \
  --id momentum-2027-01 --look-id look-1 \
  --evidence-ref docs/research-data/alpha-lab/result.json --evidence-sha256 SHA256_HEX
node scripts/alpha-lab/hypothesis-registry.js verdict \
  --id momentum-2027-01 --result-event-id alpha-lab-event-00000003 \
  --verdict FAIL --reason "The predeclared rule did not pass."
```

`PASS`, `FAIL`, and `NOT_INFORMATIVE` are descriptive study verdicts only. All verdicts remain visible; the log has no update/delete command. A later correction must be a new evidence/result event, not an overwrite.

Replace `SHA256_HEX` with the artifact's 64-character lowercase SHA-256. The command records the repository-relative reference and supplied hash; it does not open the referenced artifact or verify that hash.

## Integrity and limits

Each event has a sequence number, canonical JSON encoding, a previous-event SHA-256, and its own SHA-256. Writers take an exclusive lock and append with fsync; a held lock, malformed log, invalid transition, or hash mismatch blocks writes. The reader detects partial edits, reordering, truncation, and broken links.

This is **integrity-evident, not immutable storage**: a complete rewrite can recompute the whole chain. Git history, branch protection, and non-author review remain necessary. Timestamps are local system-clock observations, not trusted timestamping. Evidence references are repository-relative path strings with supplied hashes; the registry does not fetch or independently verify those artifacts. Semantic similarity between different hypotheses cannot be inferred from hashes alone.

Safety remains `PAPER_ONLY / ZERO_AUTHORITY / FAIL_CLOSED`; the registry has no market-data client, order, account, risk, execution, service, workflow, or release integration.
