#Requires -Version 5.1
# vibe-pipeline enduser uninstaller (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/uninstall.ps1 | iex
#
# Removes versioned install + shim. State / auth / worktrees under
# ~/.vibe-pipeline/ (other than versions/ current/ bin/) are preserved.
# To nuke everything: Remove-Item -Recurse -Force "$HOME\.vibe-pipeline"
#
# ASCII-only on purpose (Windows PS 5.1 ANSI .ps1 parser, see install.ps1 head).

$ErrorActionPreference = "Stop"

$VpHome      = Join-Path $HOME ".vibe-pipeline"
$VersionsDir = Join-Path $VpHome "versions"
$Current     = Join-Path $VpHome "current"
$ShimDir     = Join-Path $VpHome "bin"
$Shim        = Join-Path $ShimDir "vbpl.cmd"

# Legacy paths (pre-v0.2.1):
$LegacyShimDir = Join-Path $env:LOCALAPPDATA "vibe-pipeline"
$LegacyShim    = Join-Path $LegacyShimDir "vbpl.cmd"
$LegacyApp     = Join-Path $VpHome "app"            # pre-versioned install
$LegacyAppBak  = Join-Path $VpHome "app.legacy.bak" # install.ps1 migration target

function Info($m) { Write-Host $m }

# 1) Stop backend (best effort, try shim first then current/)
if (Test-Path $Shim) {
  Info "Stopping backend ..."
  try { & $Shim server stop 2>$null } catch {}
} elseif ((Get-Command bun -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $Current "cli\vbpl.ts"))) {
  $env:VBPL_HOME = $Current
  try { & bun run "$Current\cli\vbpl.ts" server stop 2>$null } catch {}
}

# 2) Remove current junction (link entry only; target version dir gets removed separately)
if (Test-Path $Current) {
  $attr = (Get-Item $Current -Force).Attributes
  if ($attr -band [System.IO.FileAttributes]::ReparsePoint) {
    # junction: rmdir removes link entry, not target
    [System.IO.Directory]::Delete($Current)
    Info "OK Removed junction $Current"
  } else {
    Remove-Item -Recurse -Force $Current
    Info "OK Removed $Current"
  }
}

# 3) Remove all version dirs
if (Test-Path $VersionsDir) {
  Remove-Item -Recurse -Force $VersionsDir
  Info "OK Removed $VersionsDir"
}

# 4) Remove shim + shim dir (if empty)
if (Test-Path $Shim) {
  Remove-Item -Force $Shim
  Info "OK Removed $Shim"
}
if ((Test-Path $ShimDir) -and -not (Get-ChildItem $ShimDir -Force)) {
  Remove-Item -Force $ShimDir
}

# 5) Cleanup legacy paths (pre-v0.2.1)
if (Test-Path $LegacyShim) {
  Remove-Item -Force $LegacyShim -ErrorAction SilentlyContinue
  Info "OK Removed legacy shim $LegacyShim"
}
if ((Test-Path $LegacyShimDir) -and -not (Get-ChildItem $LegacyShimDir -Force)) {
  Remove-Item -Force $LegacyShimDir -ErrorAction SilentlyContinue
}
if (Test-Path $LegacyApp) {
  $attr = (Get-Item $LegacyApp -Force).Attributes
  if (-not ($attr -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Recurse -Force $LegacyApp -ErrorAction SilentlyContinue
    Info "OK Removed legacy $LegacyApp"
  }
}
if (Test-Path $LegacyAppBak) {
  Remove-Item -Recurse -Force $LegacyAppBak -ErrorAction SilentlyContinue
  Info "OK Removed legacy backup $LegacyAppBak"
}

Info ""
Info "Uninstalled."
Info "Note: state / auth / worktrees under $VpHome are preserved."
Info "To wipe everything: Remove-Item -Recurse -Force `"$VpHome`""
