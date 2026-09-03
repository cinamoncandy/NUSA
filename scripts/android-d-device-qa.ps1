param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "ux/android-d-release-candidate-20260903"
$PackageName = "com.nusa.mobile.preview"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Run-Step([string]$Name, [scriptblock]$Action) {
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command pnpm
if (-not $SkipInstall) { Require-Command adb }

$dirty = git status --porcelain
if ($dirty) { throw "Working tree must be clean before device QA." }

Run-Step "Fetch exact candidate" {
  git fetch origin $ExpectedBranch
}
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne $ExpectedBranch) {
  Run-Step "Switch to candidate" { git switch $ExpectedBranch }
}
Run-Step "Fast-forward candidate" { git pull --ff-only origin $ExpectedBranch }

$head = (git rev-parse HEAD).Trim()
if ($head -notmatch '^[0-9a-f]{40}$') { throw "Could not resolve exact candidate SHA." }
$short = $head.Substring(0, 8)
Write-Host "Candidate: $head"

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 24) { throw "Node 24+ required; found $nodeVersion" }
$pnpmVersion = (& pnpm --version).Trim()
$pnpmMajor = [int]($pnpmVersion.Split('.')[0])
if ($pnpmMajor -lt 11) { throw "pnpm 11+ required; found $pnpmVersion" }

Run-Step "Install locked dependencies" { pnpm install --frozen-lockfile }
Run-Step "Preflight" { pnpm run preflight }
Run-Step "Typecheck" { pnpm run typecheck }
Run-Step "Mobile lint" { pnpm run lint:mobile }
Run-Step "Android D contract" { pnpm exec vitest run tests/android-d-device-qa-rc.vitest.js }
Run-Step "Public market regression" { node --test tests/mobile-home-public-market-fallback.test.js }
Run-Step "Repository validation" { pnpm run validate }
Run-Step "Diff whitespace check" { git diff --check }

$env:NUSA_BUILD_SHA = $head
$env:NUSA_BUILD_NUMBER = "1"
$androidDir = Join-Path $Root "apps/mobile/android"
$gradle = Join-Path $androidDir "gradlew.bat"
if (-not (Test-Path $gradle)) { throw "Gradle wrapper not found: $gradle" }

Run-Step "Assemble self-contained Android debug APK" {
  Push-Location $androidDir
  try { & $gradle :app:assembleDebug -PnusaEmbedDebugBundle }
  finally { Pop-Location }
}

$apk = Join-Path $Root "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
if (-not (Test-Path $apk)) { throw "APK not found after build: $apk" }
$apkHash = (Get-FileHash -Algorithm SHA256 $apk).Hash.ToLowerInvariant()
Write-Host "APK: $apk"
Write-Host "SHA256: $apkHash"

if ($SkipInstall) {
  Write-Host "`nPASS: machine validation and APK build completed. Device install skipped."
  exit 0
}

$deviceLines = @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
if ($deviceLines.Count -ne 1) {
  throw "Exactly one authorized Android device must be connected. Found $($deviceLines.Count)."
}
$serial = ($deviceLines[0] -split "\t")[0]
Write-Host "Device: $serial"

Run-Step "Install candidate APK" { adb -s $serial install -r $apk }
Run-Step "Launch NUSA preview" { adb -s $serial shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 }
Start-Sleep -Seconds 5

$outDir = Join-Path $Root "artifacts/android-d-device-qa/$short"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

@(
  "sourceSha=$head",
  "apkSha256=$apkHash",
  "serial=$serial",
  "model=$(adb -s $serial shell getprop ro.product.model)",
  "android=$(adb -s $serial shell getprop ro.build.version.release)",
  "sdk=$(adb -s $serial shell getprop ro.build.version.sdk)",
  "wmSize=$(adb -s $serial shell wm size)",
  "wmDensity=$(adb -s $serial shell wm density)",
  "fontScale=$(adb -s $serial shell settings get system font_scale)"
) | Set-Content -Encoding utf8 (Join-Path $outDir "device.txt")

$remoteShot = "/sdcard/nusa-d-device-qa-$short.png"
$remoteUi = "/sdcard/nusa-d-device-qa-$short.xml"
Run-Step "Capture device screenshot" {
  adb -s $serial shell screencap -p $remoteShot
  adb -s $serial pull $remoteShot (Join-Path $outDir "home.png")
  adb -s $serial shell rm $remoteShot
}
Run-Step "Capture Android UI hierarchy" {
  adb -s $serial shell uiautomator dump $remoteUi
  adb -s $serial pull $remoteUi (Join-Path $outDir "window.xml")
  adb -s $serial shell rm $remoteUi
}

Write-Host "`nPASS: machine validation, APK build, install, launch, screenshot and UI hierarchy capture completed." -ForegroundColor Green
Write-Host "Evidence: $outDir"
Write-Host "HUMAN_ONLY remaining: visually confirm default-font layout, 200% font, TalkBack, rotation/window resize, system-bar contrast, five-tab navigation, and PAPER/LIVE/AI-authority labels."
