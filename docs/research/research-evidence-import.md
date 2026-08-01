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

## Read-only status

To inspect the persisted research gate without opening the application:

```powershell
pnpm research:evidence-status -- --db C:\path\to\paper.sqlite
```

The status command opens SQLite read-only and returns `HEALTHY` only when all four
required report types are present, matched to manifests, and `PASS`. Any missing,
failed, or unverifiable report leaves the result blocked and exits non-zero.
