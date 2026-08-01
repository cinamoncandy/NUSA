# Research evidence import

`research:evidence-import` persists an already-produced research manifest/report pair in
the desktop SQLite store. It does not run research, promote a strategy, enable trading, or
create evidence from missing fields.

## Usage

Build the repository, then provide explicit absolute paths:

```powershell
pnpm research:evidence-import -- --db C:\path\to\paper.sqlite --input C:\path\to\research-evidence.json
```

The input JSON must have this shape:

```json
{
  "manifest": { "...": "validated ResearchRunManifest" },
  "report": { "...": "matching ResearchValidationReport" }
}
```

The persistence layer verifies manifest checksums, manifest/report identity, and the
result checksum. Existing rows are append-only: an identical pair is idempotent, while a
different pair with the same identity is rejected. The command reloads the persisted rows
before reporting success.

The command prints only run identity and validation status. It never prints credentials,
database contents, or absolute paths. `productionMutationAllowed` remains `false`.

## Four-gate bundle import

When an approved research workflow has produced all required validation outputs, import
them as one append-only transaction:

```powershell
pnpm research:evidence-bundle-import -- --db C:\path\to\paper.sqlite --input C:\path\to\research-bundle.json
```

The input must contain exactly four entries under `entries`, one each for
`WALK_FORWARD`, `COST_STRESS`, `MONTE_CARLO`, and `INTEGRITY_CHECK`. Every entry must
contain a checksum-valid manifest and its matching report. Duplicate run IDs, mismatched
checksums, or a missing gate are rejected before any row is written. A failure while
writing any entry rolls back the entire bundle; existing identical rows remain
idempotent and conflicting rows are rejected. This command imports evidence produced by
an external research workflow; it does not compute missing results or turn research into
Paper or live execution authority.

## Read-only status

To inspect the persisted research gate without opening the application:

```powershell
pnpm research:evidence-status -- --db C:\path\to\paper.sqlite
```

The status command opens SQLite read-only and returns `HEALTHY` only when all four
required report types are present, matched to manifests, and `PASS`. Any missing,
failed, or unverifiable report leaves the result blocked and exits non-zero.
