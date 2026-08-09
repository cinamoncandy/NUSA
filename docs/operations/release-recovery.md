# Release Recovery and Diagnostics Runbook

This runbook defines the current NUSA release-recovery drill. It is intentionally **verification-only**. It does not authorize LIVE trading, private broker mutation, credential use, automatic service restart, destructive data restore, or Evidence mutation.

## Safety invariants

- `productionMutationAllowed=false` must remain true for the release contract.
- Recovery source validation must pass `scripts/validate-disaster-recovery-restore.js` before any backup, verify, or drill action.
- Runtime diagnostics used in a bundle must pass `scripts/validate-runtime-diagnostics.js` with all mutation/private-API counters at zero.
- Recovery snapshots never contain secret-, token-, password-, credential-, API-key-, private-key-, `.env`, PEM, P12, PFX, or key-shaped paths.
- A recovery drill copies into a new temporary target only; it never overwrites the live runtime or persistent store.
- `restore` is deliberately unsupported by the recovery script. A real restore remains a separately reviewed maintenance action.
- Every successful drill writes an Evidence-bound JSON log containing the source snapshot manifest SHA-256 and its own `evidenceHashSha256`.

## 1. Prove the release inputs

Build/release validation must already have produced the current release contract:

- `build-manifest.json`
- release checksums (`*-checksums.txt`)
- SBOM (`*-SBOM.json`)

When `--release-root` is supplied, backup creation fails closed unless all three are present and the build manifest states `capabilityDescriptor.productionMutationAllowed=false`.

## 2. Create a recovery snapshot

Choose explicit source categories. Supported categories are `CONFIG`, `EVIDENCE`, `LOG`, and `DATABASE_SNAPSHOT`.

```bash
node scripts/backup-restore.js backup \
  --include CONFIG:/absolute/path/to/safe-config \
  --include EVIDENCE:/absolute/path/to/evidence \
  --include DATABASE_SNAPSHOT:/absolute/path/to/db-snapshots \
  --destination /absolute/path/to/recovery-snapshots \
  --snapshot-id release-<commit> \
  --release-root /absolute/path/to/release
```

Backup behavior:

- creates the destination when missing;
- refuses symlink sources and destinations nested inside sources;
- excludes secret-shaped paths;
- copies artifacts with restrictive permissions;
- records size and SHA-256 for every artifact;
- records release-manifest/checksum/SBOM hashes when supplied;
- writes `manifest.json` with destructive restore, production mutation, Evidence mutation, and secret inclusion all disabled.

## 3. Verify before rehearsal

```bash
node scripts/backup-restore.js verify \
  --snapshot /absolute/path/to/recovery-snapshots/release-<commit>
```

Verification fails closed on schema mismatch, missing artifact, unsafe path, duplicate path, size mismatch, checksum mismatch, changed safety flags, or a failed current DR contract.

## 4. Run a non-destructive recovery drill

```bash
node scripts/backup-restore.js drill \
  --snapshot /absolute/path/to/recovery-snapshots/release-<commit> \
  --drill-target /absolute/path/to/isolated/drill-target \
  --drill-log /absolute/path/to/evidence/release-<commit>-recovery-drill.json
```

The drill:

1. re-verifies the immutable snapshot;
2. copies every artifact to a new isolated target;
3. verifies every copied SHA-256;
4. removes the drill target by default;
5. writes an Evidence-bound drill log outside the immutable snapshot;
6. records `automaticRestartAllowed=false`, `destructiveRestoreAllowed=false`, `productionMutationAllowed=false`, and `evidenceMutationAllowed=false`.

The drill log is suitable for attachment to the governed Evidence process. The script does **not** write directly into AIPOS Evidence state or mark work complete on its own.

## 5. Generate a redacted diagnostics bundle

If runtime diagnostics exist, validate and include them:

```bash
node scripts/diagnostics-bundle.js \
  --output /absolute/path/to/diagnostics-bundle \
  --runtime-diagnostics /absolute/path/to/runtime-diagnostics.json
```

The bundle is read-only and allowlisted. It includes current architecture/release/recovery documentation and release metadata when present. Runtime diagnostics are accepted only after the current zero-mutation validator passes. Secret-shaped values are redacted and secret-shaped paths are prohibited.

The bundle manifest records per-file SHA-256 values plus:

- `productionMutationAllowed=false`
- `evidenceMutationAllowed=false`
- `secretMaterialIncluded=false`
- `redactionEnabled=true`
- DR contract status
- runtime diagnostics validation status
- release contract status when release metadata is present.

## 6. Failure handling

Stop the drill and preserve the failure evidence if any validator, checksum, schema, file, permission, or diagnostics check fails. Do not bypass a failed validator, disable checksum verification, add excluded secrets, mutate Evidence to force completion, or use the recovery tool to restart trading.

A real restore requires a separate reviewed maintenance procedure that identifies the exact target, preserves a pre-restore copy, revalidates checksums and audit anchors, applies the existing execution safety contract, and proves readiness before any later activation decision.

## Completion evidence

A release-recovery rehearsal is complete only when all of the following are available:

1. exact release manifest/checksum/SBOM evidence;
2. verified recovery snapshot manifest;
3. successful verify-only drill result;
4. Evidence-bound drill JSON log with matching snapshot manifest SHA-256 and valid `evidenceHashSha256`;
5. redacted diagnostics bundle when requested;
6. exact-head CI and required safety workflows PASS for the implementation PR.
