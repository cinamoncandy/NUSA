# NUSA Release Checklist

- [ ] Clean checkout and pinned lockfile
- [ ] Version, commit, and build date recorded in `release/build-manifest.json`
- [ ] Typecheck, build, lint, unit tests, and UI tests pass
- [ ] Package validation and Windows NSIS build pass
- [ ] Installer, application, and uninstaller smoke-tested
- [ ] Upgrade preserves settings and user data
- [ ] Rollback and recovery procedure verified
- [ ] Backup and restore integrity checked
- [ ] Crash marker and restart recovery checked
- [ ] Paper mode is the default
- [ ] `productionMutationAllowed=false`
- [ ] Private API and credentials are absent
- [ ] Evidence and recovery records are retained
- [ ] Release notes and operator documents reviewed

If any item is unknown, the release is blocked rather than approved by
assumption.
