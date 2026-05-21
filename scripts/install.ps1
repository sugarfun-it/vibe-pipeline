#Requires -Version 5.1
# vibe-pipeline enduser installer (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1 | iex
#
# Layout (Scoop-style versioned + current junction):
#   %USERPROFILE%\.vibe-pipeline\versions\v0.1.X\   actual version dir
#   %USERPROFILE%\.vibe-pipeline\current            junction -> versions\v0.1.X\
#   %LOCALAPPDATA%\vibe-pipeline\vbpl.cmd           shim, runs from %current%
#
# self-update only writes to versions\v<NEW>\ and a .pending file. `vbpl server start`
# detects .pending and swaps current. No process self-replacement, no detach magic.
#
# Note: ASCII-only on purpose. Windows PowerShell 5.1 reads .ps1 as ANSI by default;
# UTF-8 multi-byte chars (without BOM) can be misread as lead-bytes and break the parser.

$ErrorActionPreference = "Stop"

$Repo        = "eric14304/vibe-pipeline"
$VpHome      = Join-Path $HOME ".vibe-pipeline"
$VersionsDir = Join-Path $VpHome "versions"
$Current     = Join-Path $VpHome "current"
# Shim under ~/.vibe-pipeline/bin/ - aligned with pyenv/cargo/nvm convention,
# same dir as legacy vbpl.exe, uninstall just rm ~/.vibe-pipeline/.
# Pre-v0.2.1 shim at %LOCALAPPDATA%\vibe-pipeline\ is auto-cleaned below.
$ShimDir     = Join-Path $VpHome "bin"
$Shim        = Join-Path $ShimDir "vbpl.cmd"
$OldShimDir  = Join-Path $env:LOCALAPPDATA "vibe-pipeline"
$OldShim     = Join-Path $OldShimDir "vbpl.cmd"

# Keep N most recent versions for rollback after update (older ones cleaned)
$KeepVersions = 2

function Info($m) { Write-Host $m }
function Err($m)  { Write-Host "ERROR: $m" -ForegroundColor Red }

# 0) Stop running backend (so port 3001 is free + current/ has no cwd lock for swap)
#    Try existing shim first; if no shim, try via cwd current/. Errors are ignored
#    (no backend running -> nothing to stop).
$ExistingShim = $null
if (Test-Path $Shim) { $ExistingShim = $Shim }
elseif (Test-Path $OldShim) { $ExistingShim = $OldShim }
if ($ExistingShim) {
  Info "Stopping any running backend ..."
  try { & $ExistingShim server stop 2>$null } catch {}
  Start-Sleep -Milliseconds 500
} elseif ((Get-Command bun -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $Current "cli\vbpl.ts"))) {
  Info "Stopping any running backend (via current/) ..."
  $env:VBPL_HOME = $Current
  try { & bun run "$Current\cli\vbpl.ts" server stop 2>$null } catch {}
  Start-Sleep -Milliseconds 500
}

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

# 3) Pick asset: prefer .tar.gz / .tgz (build-tarball.ts output), then .zip, then zipball_url fallback.
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

# 4) Download
$isZip = $assetName -match '\.zip$' -or $assetUrl -match 'zipball'
$ext = if ($isZip) { "zip" } else { "tar.gz" }
$tarball = Join-Path $env:TEMP "vibe-pipeline-$Tag.$ext"
Info "Downloading to $tarball ..."
try {
  Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $tarball
} catch {
  Err "Download failed: $_"; exit 1
}

# 5) Stage extract to versions\$Tag (independent dir, never touches running backend)
New-Item -ItemType Directory -Force -Path $VersionsDir | Out-Null
$VersionDir = Join-Path $VersionsDir $Tag

# overwrite existing same-version dir (retry / re-install case)
if (Test-Path $VersionDir) {
  Info "Removing existing $VersionDir"
  Remove-Item -Recurse -Force $VersionDir -ErrorAction Stop
}

$stage = Join-Path $env:TEMP "vibe-pipeline-stage-$Tag"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Info "Extracting ..."
try {
  if ($isZip) {
    Expand-Archive -Path $tarball -DestinationPath $stage -Force
  } else {
    # Explicit System32 tar (native bsdtar, Win10 17063+). git-for-Windows usr/bin/tar.exe
    # is MSYS bsdtar which mangles `C:\path` -> `C\:\\path`. Absolute path avoids that.
    $winTar = Join-Path $env:WINDIR "System32\tar.exe"
    & $winTar -xzf $tarball -C $stage
    if ($LASTEXITCODE -ne 0) { throw "tar failed (exit=$LASTEXITCODE)" }
  }

  # tarball/zipball top-level is usually <repo>-<sha>/ (strip it)
  $entries = Get-ChildItem -Path $stage
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    Move-Item $entries[0].FullName $VersionDir
  } else {
    New-Item -ItemType Directory -Force -Path $VersionDir | Out-Null
    Move-Item (Join-Path $stage "*") $VersionDir
  }
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  Info "OK Extracted -> $VersionDir"
} catch {
  Err "Extract failed: $_"
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
  if (Test-Path $VersionDir) { Remove-Item -Recurse -Force $VersionDir -ErrorAction SilentlyContinue }
  exit 1
}
Remove-Item -Force $tarball -ErrorAction SilentlyContinue

# 6) Install deps inside versions\$Tag
Info "Running bun install (30s ~ 2 min) ..."
Push-Location $VersionDir
try {
  & bun install --silent
  if ($LASTEXITCODE -ne 0) { throw "bun install exit=$LASTEXITCODE" }
} catch {
  Err "bun install failed: $_"
  Pop-Location
  exit 1
}
Pop-Location

# 7) Swap `current` junction to new version
if (Test-Path $Current) {
  # junction reports as Directory; Remove-Item recursive on a junction removes the link only
  Info "Removing old current link"
  Remove-Item -Recurse -Force $Current -ErrorAction Stop
}
Info "Creating junction $Current -> $VersionDir"
New-Item -ItemType Junction -Path $Current -Target $VersionDir | Out-Null

# 7.2) Cleanup old versions: keep $KeepVersions most recent (including current $Tag),
#      remove the rest. Identifies "version dirs" as any subdirectory of versions/ except
#      *.staging (in case future code uses staging dirs). Uses LastWriteTime as proxy for "recent".
try {
  $allVersionDirs = Get-ChildItem -Path $VersionsDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '\.staging$' } |
    Sort-Object LastWriteTime -Descending
  if ($allVersionDirs.Count -gt $KeepVersions) {
    $toRemove = $allVersionDirs | Select-Object -Skip $KeepVersions
    foreach ($d in $toRemove) {
      try {
        Remove-Item -Recurse -Force $d.FullName -ErrorAction Stop
        Info "Cleaned up old version $($d.Name)"
      } catch {
        Info "WARN: cleanup old version $($d.Name) failed: $_"
      }
    }
  }
} catch {
  Info "WARN: old-version cleanup scan failed: $_"
}

# 7.5) Legacy migration: old layout had `app/` directly under VpHome. If present, move
# to `app.legacy.bak/` so user can clean up later. Avoid touching it if it's a junction.
$LegacyApp = Join-Path $VpHome "app"
if (Test-Path $LegacyApp) {
  $legacyAttr = (Get-Item $LegacyApp -Force).Attributes
  if (-not ($legacyAttr -band [System.IO.FileAttributes]::ReparsePoint)) {
    $LegacyBak = Join-Path $VpHome "app.legacy.bak"
    if (Test-Path $LegacyBak) { Remove-Item -Recurse -Force $LegacyBak -ErrorAction SilentlyContinue }
    try {
      Move-Item $LegacyApp $LegacyBak
      Info "Legacy $LegacyApp moved to $LegacyBak (safe to delete)"
    } catch {
      Info "WARN: legacy $LegacyApp move failed (in use?): $_"
    }
  }
}

# 8) Shim points to current\
New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
$shimContent = @"
@echo off
set VBPL_HOME=%USERPROFILE%\.vibe-pipeline\current
bun run "%VBPL_HOME%\cli\vbpl.ts" %*
"@
Set-Content -Path $Shim -Value $shimContent -Encoding ASCII
Info "OK Shim: $Shim"

# 8.5) Cleanup legacy shim at %LOCALAPPDATA%\vibe-pipeline\ (pre-v0.2.1)
if (Test-Path $OldShim) {
  try {
    Remove-Item -Force $OldShim -ErrorAction Stop
    Info "Cleaned up legacy shim $OldShim"
  } catch {
    Info "WARN: cleanup legacy $OldShim failed: $_"
  }
}
if ((Test-Path $OldShimDir) -and -not (Get-ChildItem $OldShimDir -Force)) {
  Remove-Item -Force $OldShimDir -ErrorAction SilentlyContinue
}

# 9) PATH check + prompt
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

# 10) Auto-start backend (uses current\ via VBPL_HOME)
Info ""
Info "Starting backend ..."
$env:VBPL_HOME = $Current
try {
  & bun run "$Current\cli\vbpl.ts" server start
} catch {
  Err "server start failed. Try manually: vbpl server start"
}

Info ""
Info "OK Installed $Tag at $VersionDir"
Info "OK current -> $VersionDir"
Info "OK Backend: http://localhost:3001"
Info ""
Info "Done. Run 'vbpl --help' for commands."
