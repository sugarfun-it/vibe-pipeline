#Requires -Version 5.1
# vibe-pipeline enduser installer (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/sugarfun-it/vibe-pipeline/main/scripts/install.ps1 | iex
#
# Optional flag: pass -AutoStart to start backend at end (only safe when invoked
# from a non-pipe context - e.g. backend /api/system/update). Default off because
# auto-starting via terminal pipe leaks backend stdio handles up the chain and
# hangs caller on Windows.
#
# Layout (Scoop-style versioned + current junction):
#   %USERPROFILE%\.vibe-pipeline\versions\v0.1.X\   actual version dir
#   %USERPROFILE%\.vibe-pipeline\current            junction -> versions\v0.1.X\
#   %USERPROFILE%\.vibe-pipeline\bin\vbpl.cmd       shim, runs from %current%
#
# Note: ASCII-only on purpose. Windows PowerShell 5.1 reads .ps1 as ANSI by default;
# UTF-8 multi-byte chars (without BOM) can be misread as lead-bytes and break the parser.

param(
  [switch]$AutoStart
)

$ErrorActionPreference = "Stop"

$Repo        = "sugarfun-it/vibe-pipeline"
$VpHome      = Join-Path $HOME ".vibe-pipeline"
$VersionsDir = Join-Path $VpHome "versions"
$Current     = Join-Path $VpHome "current"

# Always log to update.log so PWA-triggered hidden installs are debuggable.
# -Force overrides "transcript already in progress" if user runs multiple installs.
# Append=$true so previous install logs preserved (resetLog in backend truncates first).
New-Item -ItemType Directory -Force -Path $VpHome | Out-Null
try {
  Start-Transcript -Path (Join-Path $VpHome "update.log") -Append -Force | Out-Null
} catch { }

# cd to $VpHome so we are NEVER inside $Current/. Otherwise step 7 (remove current
# junction) fails when current is the script's own cwd (Windows "directory in use").
# Caller may invoke install.ps1 from anywhere; we don't trust cwd.
New-Item -ItemType Directory -Force -Path $VpHome | Out-Null
Set-Location -LiteralPath $VpHome
# Shim under ~/.vibe-pipeline/bin/ - aligned with pyenv/cargo/nvm convention,
# uninstall just rm ~/.vibe-pipeline/.
# v0.2.5+ ships Rust .exe shim (vbpl.exe) inside tarball at $VersionDir\bin\vbpl.exe;
# install.ps1 prefers .exe (solves Node/Bun spawn ENOENT + cmd.exe re-tokenize + PATHEXT
# 大小寫雷區). Older tarballs without bin/vbpl.exe fall back to generating vbpl.cmd.
# Pre-v0.2.1 shim at %LOCALAPPDATA%\vibe-pipeline\ is auto-cleaned below.
$ShimDir     = Join-Path $VpHome "bin"
$ShimExe     = Join-Path $ShimDir "vbpl.exe"
$ShimCmd     = Join-Path $ShimDir "vbpl.cmd"
$OldShimDir  = Join-Path $env:LOCALAPPDATA "vibe-pipeline"
$OldShim     = Join-Path $OldShimDir "vbpl.cmd"

# Keep N most recent versions for rollback after update (older ones cleaned)
$KeepVersions = 2

function Info($m) { Write-Host $m }
function Err($m)  { Write-Host "ERROR: $m" -ForegroundColor Red }

# 0) Detect existing shim now, but DO NOT stop the backend yet.
#    The actual stop happens AFTER the new release is fetched + downloaded (see below),
#    so a transient GitHub failure (e.g. /releases/latest 504) never kills a running
#    backend and then aborts, leaving the user with no backend at all.
$ExistingShim = $null
if (Test-Path $ShimExe) { $ExistingShim = $ShimExe }
elseif (Test-Path $ShimCmd) { $ExistingShim = $ShimCmd }
elseif (Test-Path $OldShim) { $ExistingShim = $OldShim }

# 1) Bun check
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Err "Bun is not installed. Install Bun first:"
  Err "  powershell -c ""irm bun.sh/install.ps1 | iex"""
  Err "Then open a new terminal and re-run install.ps1"
  exit 1
}
Info "OK Bun: $(bun --version)"

# 2) Latest release (fetched BEFORE stopping backend).
#    GitHub intermittently 504s the /releases/latest endpoint for a specific repo
#    while the list endpoint stays healthy. Fall back to the releases list and pick
#    the first non-draft / non-prerelease entry (list is published-desc ordered).
Info "Fetching latest release ..."
$api = $null
try {
  $api = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
} catch {
  Info "  /releases/latest failed ($($_.Exception.Message)); trying releases list ..."
  try {
    $list = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases?per_page=10"
    $api = $list | Where-Object { -not $_.draft -and -not $_.prerelease } | Select-Object -First 1
  } catch {
    Err "Failed to fetch release info (latest + list both failed): $_"
    exit 1
  }
}
if (-not $api) { Err "No published release found"; exit 1 }
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

# 4.5) Stop running backend NOW - release is fetched + downloaded, so from here on
#      every failure path can safely leave the backend down (we are committed to the
#      swap). Stopping frees port 3001 + releases the cwd/junction lock for step 7.
#      Errors are ignored (no backend running -> nothing to stop).
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

# 4.6) Reap orphan worktree preview servers. The old backend spawned sub-agents that
#      spawn vite/proto dev servers under .vibe-pipeline\worktrees\; on Windows those
#      inherit the backend's listening socket handle and can outlive it, pinning port
#      3001 as a zombie so the new backend cannot bind it. Kill any node/bun whose
#      command line is under a .vibe-pipeline\worktrees path (never touches the target
#      repo's own dev servers, which live outside worktrees).
try {
  $orphans = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bun.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '\.vibe-pipeline[\\/]+worktrees' }
  $killed = 0
  foreach ($o in $orphans) {
    try { Stop-Process -Id $o.ProcessId -Force -ErrorAction Stop; $killed++ } catch {}
  }
  if ($killed -gt 0) { Info "Reaped $killed orphan worktree preview server(s)" }
} catch {}

# 5) Stage extract to versions\$Tag (independent dir, never touches running backend)
New-Item -ItemType Directory -Force -Path $VersionsDir | Out-Null
$VersionDir = Join-Path $VersionsDir $Tag

# Move existing $VersionDir aside (rename usually works on Windows even when contents
# are file-locked; Remove-Item -Recurse can hang minutes when prev backend's memory-mapped
# image hasn't been released). Cleanup of bak dir happens in background, best-effort.
# Same-version re-install (test / debug case) is the only path that hits this - real
# enduser update has different version tag, $VersionDir won't exist.
if (Test-Path $VersionDir) {
  $bak = "$VersionDir.bak-$(Get-Random -Maximum 99999)"
  $moved = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      Move-Item -Path $VersionDir -Destination $bak -ErrorAction Stop
      $moved = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $moved) {
    Err "Cannot move existing $VersionDir aside after 10s (parent dir locked)"
    exit 1
  }
  Info "Moved existing $VersionDir aside to $bak (background cleanup)"
  # Background cleanup of .bak (waits 30s for locks to release, then nukes)
  Start-Job -ScriptBlock {
    param($p)
    Start-Sleep 30
    Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
  } -ArgumentList $bak | Out-Null
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

# 8) Shim install: prefer Rust .exe shipped in tarball ($VersionDir\bin\vbpl.exe),
#    fall back to generated .cmd for older tarballs (pre-v0.2.5).
#    .exe solves Node/Bun spawn ENOENT, cmd.exe re-tokenize, PATHEXT case雷;.cmd
#    is legacy fallback. Always remove the *other* extension so PATHEXT resolves
#    deterministically (no two siblings competing).
New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
$BundledExe = Join-Path $VersionDir "bin\vbpl.exe"
if (Test-Path $BundledExe) {
  Copy-Item -Path $BundledExe -Destination $ShimExe -Force
  if (Test-Path $ShimCmd) { Remove-Item -Force $ShimCmd -ErrorAction SilentlyContinue }
  Info "OK Shim (exe): $ShimExe"
} else {
  $shimContent = @"
@echo off
set VBPL_HOME=%USERPROFILE%\.vibe-pipeline\current
bun run "%VBPL_HOME%\cli\vbpl.ts" %*
"@
  Set-Content -Path $ShimCmd -Value $shimContent -Encoding ASCII
  if (Test-Path $ShimExe) { Remove-Item -Force $ShimExe -ErrorAction SilentlyContinue }
  Info "OK Shim (cmd fallback, tarball missing bin/vbpl.exe): $ShimCmd"
}

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

# 10) Optionally auto-start backend
#
# Default off: starting backend from this script via terminal-pipe caller leaks
# backend stdio handles up the chain and hangs caller on Windows. -AutoStart is
# safe ONLY when invoked from a non-pipe context (e.g. backend /api/system/update
# spawns this script with stdio: file - backend exits 500ms later, no stdio chain
# back to PWA HTTP request).
if ($AutoStart) {
  Info ""
  Info "Starting backend (AutoStart) ..."
  $env:VBPL_HOME = $Current
  try {
    Start-Process -FilePath "bun" `
      -ArgumentList "run", "$Current\cli\vbpl.ts", "server", "start" `
      -WorkingDirectory $Current `
      -WindowStyle Hidden
  } catch {
    Err "server start failed to launch: $_"
  }
  # `vbpl server start` (launched above) already spawns the backend fully detached
  # (stdio -> log file + unref) and waits for /api/health on its own. So here we only
  # do a SHORT confirm (<= ~20s, breaks as soon as healthy) and then return no matter
  # what. Blocking on the full double cold-start (used to poll ~90s) is exactly what
  # kept this window hanging open. If health is not up yet it is almost certainly still
  # coming up in the background; the app's own health/version UI shows the real state.
  $healthy = $false
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $null = Invoke-RestMethod -UseBasicParsing -Uri "http://localhost:3001/api/health" -TimeoutSec 1
      $healthy = $true; break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if ($healthy) {
    Info "OK Backend up on http://localhost:3001"
  } else {
    Info "Backend still starting in the background (vbpl server start keeps waiting)."
    Info "If it never comes up, check $VpHome\server.log or run: vbpl server start"
  }
} else {
  Info ""
  Info "Install complete. To start backend, run:"
  Info ""
  Info "  vbpl server start"
  Info ""
}

Info "OK Installed $Tag at $VersionDir"
Info "OK current -> $VersionDir"

# Self-cleanup: PWA-triggered update via backend creates a "VibePipelineUpdate" Task Scheduler
# task to escape Bun job-object KILL_ON_CLOSE on Windows (see server/lib/updater.ts).
# Delete it after install completes. Failures are ignored (manual installs skip schtasks).
# Manual install path: task does not exist, schtasks exits 1 + writes stderr but
# *>$null does NOT clear $LASTEXITCODE. Caller then misreads $LASTEXITCODE=1 as a
# failed install (when in fact install succeeded). Reset explicitly.
try {
  schtasks /delete /tn "VibePipelineUpdate" /f *> $null
} catch { }
$global:LASTEXITCODE = 0

Info ""
Info "Done. Run 'vbpl server start' to launch backend, then 'vbpl --help'."

try { Stop-Transcript | Out-Null } catch { }
