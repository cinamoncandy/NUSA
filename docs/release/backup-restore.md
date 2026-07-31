# Backup and Restore

`pnpm run backup:create` creates a manifest-backed snapshot for configuration, Evidence, logs, and database paths supplied by environment variables. Missing sources are recorded as `UNAVAILABLE`; they are never silently treated as a complete backup.

The manifest records schema version, UTC creation time, availability, and SHA256 per entry. Restore must verify the manifest and checksums, confirm the application/database version, and preserve the original backup. Restore does not enable live mutation and does not delete Evidence.
