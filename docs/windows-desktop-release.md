# Windows Desktop Stable Release

The canonical Windows desktop application is distributed from the `nusa-windows` GitHub release.

The release workflow accepts only the exact current `main` commit after canonical CI succeeds. It builds the Electron NSIS installer on `windows-latest`, validates the package, records canonical renderer hashes and safety invariants, then updates the stable release assets.

Assets:

- `NUSA-Windows-Setup.exe`
- `NUSA-Windows-Setup.exe.sha256`
- `NUSA-Windows.provenance.txt`

The installer is intentionally unsigned for private/personal use. Installing a newer release replaces the application binaries while preserving user data according to the existing NSIS configuration.

A Cloudflare Worker deployment does not update this desktop UI. Desktop UI changes become visible only after this Windows release workflow publishes a new installer and that installer is installed.
