#Requires -Version 5.1
# vibe-pipeline enduser installer (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1 | iex
#
# Note: ASCII-only on purpose. Windows PowerShell 5.1 reads .ps1 as ANSI by default;
# UTF-8 multi-byte chars (without BOM) can be misread as lead-bytes and break the parser.

$ErrorActionPreference = "Stop"

$Repo    = "eric14304/vibe-pipeline"
$VpHome  = Join-Path $HOME ".vibe-pipeline"
$AppDir  = Join-Path $VpHome "app"
$AppBak  = Join-Path $VpHome "app.bak"
$ShimDir = Join-Path $env:LOCALAPPDATA "vibe-pipeline"
$Shim    = Join-Path $ShimDir "vbpl.cmd"

function Info($m) { Write-Host $m }
function Err($m)  { Write-Host "ERROR: $m" -ForegroundColor Red }

# 1) Bun check
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Err "Bun is not installed. Install Bun first:"
  Err "  powershell -c ""irm bun.sh/install.ps1 | iex"""
  Err "Then open a new terminal and re-run install.ps1"
  exit 1
}
Info "OK Bun: $(bun --version)"

# 2) Latest release
Info "Fetching latest release ..."
try {
  $api = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
} catch {
  Err "Failed to fetch release info: $_"
  exit 1
}
$Tag = $api.tag_name
if (-not $Tag) { Err "tag_name not found in release JSON"; exit 1 }
Info "OK Latest tag: $Tag"

# Prefer .tar.gz / .tgz (build-tarball.ts output), then .zip, then zipball_url fallback.
$asset = $api.assets | Where-Object { $_.name -match '\.(tar\.gz|tgz)$' } | Select-Object -First 1
if (-not $asset) {
  $asset = $api.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
}
if ($asset) {
  $assetUrl = $asset.browser_download_url
  $assetName = $asset.name
} else {
  $assetUrl = $api.zipball_url
  $assetName = "source.zip"
  Info "  No .tar.gz/.zip asset, using zipball_url fallback"
}
if (-not $assetUrl) { Err "No download URL found"; exit 1 }
Info "OK Download URL: $assetUrl"

# 3) Download
$isZip = $assetName -match '\.zip$' -or $assetUrl -match 'zipball'
$ext = if ($isZip) { "zip" } else { "tar.gz" }
$tarball = Join-Path $env:TEMP "vibe-pipeline-$Tag.$ext"
Info "Downloading to $tarball ..."
try {
  Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $tarball
} catch {
  Err "Download failed: $_"; exit 1
}

# 4) Extract (safety net: mv app -> app.bak before extract, restore on failure)
New-Item -ItemType Directory -Force -Path $VpHome | Out-Null
if (Test-Path $AppDir) {
  if (Test-Path $AppBak) { Remove-Item -Recurse -Force $AppBak }
  Move-Item $AppDir $AppBak
}

$stage = Join-Path $env:TEMP "vibe-pipeline-stage-$Tag"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Info "Extracting ..."
try {
  if ($isZip) {
    Expand-Archive -Path $tarball -DestinationPath $stage -Force
  } else {
    # tar is built-in on Win10+
    tar -xzf $tarball -C $stage
    if ($LASTEXITCODE -ne 0) { throw "tar failed (exit=$LASTEXITCODE)" }
  }

  # tarball/zipball top-level is usually <repo>-<sha>/ (strip it)
  $entries = Get-ChildItem -Path $stage
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    Move-Item $entries[0].FullName $AppDir
  } else {
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
    Move-Item (Join-Path $stage "*") $AppDir
  }
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  if (Test-Path $AppBak) { Remove-Item -Recurse -Force $AppBak }
  Info "OK Extracted -> $AppDir"
} catch {
  Err "Extract failed, rolling back: $_"
  if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
  if (Test-Path $AppBak) { Move-Item $AppBak $AppDir }
  exit 1
}
Remove-Item -Force $tarball -ErrorAction SilentlyContinue

# 4.5) Install deps
Info "Running bun install (30s ~ 2 min) ..."
Push-Location $AppDir
try {
  & bun install --silent
  if ($LASTEXITCODE -ne 0) { throw "bun install exit=$LASTEXITCODE" }
} catch {
  Err "bun install failed: $_"
  Pop-Location
  exit 1
}
Pop-Location

# 5) Shim
New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
$shimContent = @"
@echo off
set VBPL_HOME=%USERPROFILE%\.vibe-pipeline\app
bun run "%VBPL_HOME%\cli\vbpl.ts" %*
"@
Set-Content -Path $Shim -Value $shimContent -Encoding ASCII
Info "OK Shim: $Shim"

# 6) PATH check + prompt
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$inPath = $false
if ($userPath) {
  foreach ($p in $userPath.Split(';')) {
    if ($p.TrimEnd('\') -ieq $ShimDir.TrimEnd('\')) { $inPath = $true; break }
  }
}
if (-not $inPath) {
  $reply = Read-Host "Add $ShimDir to user PATH? (y/N)"
  if ($reply -match '^(y|Y|yes)$') {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $ShimDir } else { "$userPath;$ShimDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$ShimDir"
    Info "OK Added to user PATH (open new terminal to take effect)"
  } else {
    Info "PATH not modified. To add manually run:"
    Info "  [Environment]::SetEnvironmentVariable(""Path"", ""`$env:Path;$ShimDir"", ""User"")"
  }
}

# 7) Auto-start backend
Info ""
Info "Starting backend ..."
$env:VBPL_HOME = $AppDir
try {
  & bun run "$AppDir\cli\vbpl.ts" server start
} catch {
  Err "server start failed. Try manually: vbpl server start"
}

Info ""
Info "OK Installed $Tag at $AppDir"
Info "OK Backend: http://localhost:3001"
Info ""
Info "Done. Run 'vbpl --help' for commands."
