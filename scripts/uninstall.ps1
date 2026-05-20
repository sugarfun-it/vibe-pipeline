#Requires -Version 5.1
# vibe-pipeline enduser uninstaller (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/uninstall.ps1 | iex

$ErrorActionPreference = "Stop"

$VpHome  = Join-Path $HOME ".vibe-pipeline"
$AppDir  = Join-Path $VpHome "app"
$ShimDir = Join-Path $env:LOCALAPPDATA "vibe-pipeline"
$Shim    = Join-Path $ShimDir "vbpl.cmd"

function Info($m) { Write-Host $m }

# 1) Stop backend (best effort)
if (Test-Path $Shim) {
  Info "停 backend ..."
  try { & $Shim server stop 2>$null } catch {}
} elseif ((Get-Command bun -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $AppDir "cli\vbpl.ts"))) {
  $env:VBPL_HOME = $AppDir
  try { & bun run "$AppDir\cli\vbpl.ts" server stop 2>$null } catch {}
}

# 2) Remove app dir
if (Test-Path $AppDir) {
  Remove-Item -Recurse -Force $AppDir
  Info "OK 移除 $AppDir"
}

# 3) Remove shim
if (Test-Path $Shim) {
  Remove-Item -Force $Shim
  Info "OK 移除 $Shim"
}
# 清空殼 dir
if ((Test-Path $ShimDir) -and -not (Get-ChildItem $ShimDir -Force)) {
  Remove-Item -Force $ShimDir
}

Info ""
Info "Uninstalled."
Info "註:$VpHome 內 state / auth / worktrees 沒動。要全清:"
Info "  Remove-Item -Recurse -Force `"$VpHome`""
