# NUSA iPhone / TestFlight deployment

This runbook turns the existing React Native iOS Release build into a signed App Store Connect upload for TestFlight.

## Safety boundary

- This workflow distributes the mobile client only.
- It does not add LIVE trading authority, broker mutation credentials, or production trading secrets.
- The mobile client remains fail-closed and read-only for server operations unless the existing product architecture explicitly changes through its normal governance path.
- The TestFlight workflow is manual (`workflow_dispatch`) and runs in the protected GitHub `testflight` environment.

## Current iOS identity

- Scheme: `NusaMobile`
- Bundle ID: `com.nusa.trader`
- Minimum iOS: 15.0
- Distribution target: TestFlight / App Store Connect

If Apple Developer cannot register `com.nusa.trader` for the owning team, change the bundle identifier in the Xcode project and `.github/workflows/ios-testflight.yml` in the same reviewed change before creating signing assets.

## One-time Apple setup

1. Join/activate the Apple Developer Program for the account that will own NUSA.
2. In Certificates, Identifiers & Profiles, register an explicit App ID for `com.nusa.trader`.
3. Create an **Apple Distribution** certificate and export the certificate plus private key as a password-protected `.p12` file.
4. Create an **App Store** provisioning profile for `com.nusa.trader` using that distribution identity and download the `.mobileprovision` file.
5. In App Store Connect, create the NUSA app record manually and select the same bundle ID. Apple requires the app record to exist before an uploaded build can be associated with the app.
6. Create an App Store Connect API key with sufficient app access for build upload. Save the Key ID, Issuer ID, and the downloaded `.p8` private key. Apple only lets you download the private key once, so store it securely.

## GitHub `testflight` environment

Create a GitHub Actions environment named `testflight`. Add these environment secrets:

- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`

The workflow deliberately fails before archive/sign/upload when any required value is missing.

### Base64 encoding on Windows PowerShell

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("NUSA_Distribution.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("NUSA_AppStore.mobileprovision")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard
```

Paste each clipboard value into the matching GitHub secret. Never commit the `.p12`, `.mobileprovision`, `.p8`, passwords, Team ID, Key ID, or Issuer ID into repository files.

## Upload a build

1. Merge the TestFlight workflow after normal CI passes.
2. Open GitHub Actions → **iOS TestFlight**.
3. Choose **Run workflow** on `main`.
4. The workflow will:
   - verify all deployment inputs are present;
   - require Xcode 16 or newer;
   - install locked JavaScript and CocoaPods dependencies;
   - install the Apple Distribution certificate in an ephemeral keychain;
   - validate the provisioning profile matches the Apple Team and `com.nusa.trader`;
   - reject a development provisioning profile;
   - archive a signed physical-device Release build;
   - export an App Store Connect IPA;
   - validate the IPA with App Store Connect;
   - upload the IPA;
   - delete signing material from the runner.
5. Wait for Apple to process the uploaded build in App Store Connect → TestFlight.
6. Add the intended Apple ID as an internal tester if it is not already eligible.
7. Install Apple's TestFlight app on the iPhone and install NUSA from the invitation/TestFlight list.

## Real-device acceptance gate

A successful upload is not the end of validation. Mark **Real Device PASS** only after the TestFlight build is installed on a physical iPhone and all of the following are verified:

- clean installation succeeds;
- NUSA launches without a crash;
- local sign-in screen renders and sign-in enters the app;
- Home / Markets / PAPER / Portfolio / AI navigation works;
- read-only authority labels are visible and truthful;
- missing dashboard credentials fail closed;
- configured HTTPS PAPER operations endpoint can be reached from the phone;
- background → foreground and force-quit → relaunch work;
- no P0/P1 regression is observed.

The default mobile API URL is loopback. A physical iPhone cannot use the developer machine's `127.0.0.1`; real PAPER data requires an HTTPS endpoint reachable by the phone and configured for the release build.
