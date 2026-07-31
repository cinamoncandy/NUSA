# Rollback

1. Stop distribution of the affected installer.
2. Record the release manifest commit and artifact checksum.
3. Preserve logs, Evidence, and database snapshots; do not delete or rewrite them.
4. Reinstall the last verified Windows artifact.
5. Run configuration/database migration compatibility checks before startup.
6. Keep live mutation disabled and verify the capability descriptor.
7. Reconcile recovery and Evidence state before allowing any future operating step.

Rollback is a deployment action, not a data reset. No recovery record or Evidence archive is deleted.
