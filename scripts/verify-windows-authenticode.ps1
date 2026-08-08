param(
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$ExpectedCommit,
  [Parameter(Mandatory = $true)][string]$WorkflowRunId
)

$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $ArtifactDirectory "build-manifest.json"
if (-not (Test-Path $manifestPath)) { throw "MISSING_BUILD_MANIFEST" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.commit -ne $ExpectedCommit -and $manifest.sourceCommit -ne $ExpectedCommit) { throw "SOURCE_COMMIT_MISMATCH" }
if ($manifest.capabilityDescriptor.productionMutationAllowed -ne $false) { throw "UNSAFE_RELEASE_DESCRIPTOR" }

$artifacts = @(Get-ChildItem -Path $ArtifactDirectory -Recurse -File -Filter *.exe)
if ($artifacts.Count -eq 0) { throw "NO_WINDOWS_EXECUTABLE" }
$records = foreach ($artifact in $artifacts) {
  $signature = Get-AuthenticodeSignature -FilePath $artifact.FullName
  if ($signature.Status -ne "Valid") { throw "AUTHENTICODE_INVALID:$($artifact.Name):$($signature.Status)" }
  if ($null -eq $signature.SignerCertificate) { throw "AUTHENTICODE_CERTIFICATE_MISSING:$($artifact.Name)" }
  $timestamp = $signature.TimeStamperCertificate
  $hash = (Get-FileHash -Algorithm SHA256 -Path $artifact.FullName).Hash.ToLowerInvariant()
  [ordered]@{
    artifactFilename = $artifact.Name
    artifactSha256 = $hash
    authenticodeStatus = [string]$signature.Status
    certificateSubject = $signature.SignerCertificate.Subject
    certificateIssuer = $signature.SignerCertificate.Issuer
    certificateNotAfter = $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString("o")
    timestampPresent = ($null -ne $timestamp)
    timestampIssuer = if ($null -ne $timestamp) { $timestamp.Issuer } else { $null }
  }
}
if (@($records | Where-Object { $_.timestampPresent -ne $true }).Count -gt 0) { throw "AUTHENTICODE_TIMESTAMP_MISSING" }

$evidence = [ordered]@{
  schemaVersion = 1
  version = $manifest.version
  sourceCommit = $ExpectedCommit
  workflowRunId = $WorkflowRunId
  buildTimestamp = (Get-Date).ToUniversalTime().ToString("o")
  productionMutationAllowed = $false
  repository = $env:GITHUB_REPOSITORY
  workflowRef = $env:GITHUB_REF
  runnerArchitecture = $env:RUNNER_ARCH
  verification = "Get-AuthenticodeSignature"
  artifacts = @($records)
}
$output = Join-Path $ArtifactDirectory "signing-verification.json"
$evidence | ConvertTo-Json -Depth 8 | Set-Content -Path $output -Encoding UTF8
Write-Output ($evidence | ConvertTo-Json -Depth 8)
