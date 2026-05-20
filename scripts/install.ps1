#Requires -Version 5.1
# vibe-pipeline enduser installer (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/eric14304/vibe-pipeline/main/scripts/install.ps1 | iex

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
  Err "Bun 未安裝。請先跑:"
  Err "  powershell -c ""irm bun.sh/install.ps1 | iex"""
  Err "裝完重開 terminal 再跑 install.ps1"
  exit 1
}
Info "OK Bun: $(bun --version)"

# 2) Latest release
Info "查 latest release ..."
try {
  $api = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
} catch {
  Err "抓 release info 失敗: $_"
  exit 1
}
$Tag = $api.tag_name
if (-not $Tag) { Err "無法解析 tag_name"; exit 1 }
Info "OK Latest tag: $Tag"

# 找 .zip asset 優先,沒就 .tar.gz,再沒就 zipball_url fallback
$asset = $api.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
if (-not $asset) {
  $asset = $api.assets | Where-Object { $_.name -match '\.(tar\.gz|tgz)$' } | Select-Object -First 1
}
if ($asset) {
  $assetUrl = $asset.browser_download_url
  $assetName = $asset.name
} else {
  $assetUrl = $api.zipball_url
  $assetName = "source.zip"
  Info "  無 .zip asset,改用 zipball_url"
}
if (-not $assetUrl) { Err "找不到下載 URL"; exit 1 }
Info "OK Download URL: $assetUrl"

# 3) Download
$isZip = $assetName -match '\.zip$' -or $assetUrl -match 'zipball'
$ext = if ($isZip) { "zip" } else { "tar.gz" }
$tarball = Join-Path $env:TEMP "vibe-pipeline-$Tag.$ext"
Info "下載到 $tarball ..."
try {
  Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -OutFile $tarball
} catch {
  Err "下載失敗: $_"; exit 1
}

# 4) Extract (safety net)
New-Item -ItemType Directory -Force -Path $VpHome | Out-Null
if (Test-Path $AppDir) {
  if (Test-Path $AppBak) { Remove-Item -Recurse -Force $AppBak }
  Move-Item $AppDir $AppBak
}

$stage = Join-Path $env:TEMP "vibe-pipeline-stage-$Tag"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Info "解壓 ..."
try {
  if ($isZip) {
    Expand-Archive -Path $tarball -DestinationPath $stage -Force
  } else {
    # tar 在 Win10+ 內建
    tar -xzf $tarball -C $stage
    if ($LASTEXITCODE -ne 0) { throw "tar 失敗 (exit=$LASTEXITCODE)" }
  }

  # tarball / zipball 第一層通常是 <repo>-<sha>/,搬上來
  $entries = Get-ChildItem -Path $stage
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    Move-Item $entries[0].FullName $AppDir
  } else {
    New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
    Move-Item (Join-Path $stage "*") $AppDir
  }
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  if (Test-Path $AppBak) { Remove-Item -Recurse -Force $AppBak }
  Info "OK 解壓 → $AppDir"
} catch {
  Err "解壓失敗,回滾: $_"
  if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
  if (Test-Path $AppBak) { Move-Item $AppBak $AppDir }
  exit 1
}
Remove-Item -Force $tarball -ErrorAction SilentlyContinue

# 4.5) Install deps
Info "bun install (可能要 30s ~ 2 分鐘) ..."
Push-Location $AppDir
try {
  & bun install --silent
  if ($LASTEXITCODE -ne 0) { throw "bun install exit=$LASTEXITCODE" }
} catch {
  Err "bun install 失敗: $_"
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
    Info "OK 已加進 user PATH — 開新 terminal 生效"
  } else {
    Info "PATH 沒加。要手動跑:"
    Info "  [Environment]::SetEnvironmentVariable(""Path"", ""`$env:Path;$ShimDir"", ""User"")"
  }
}

# 7) Auto-start backend
Info ""
Info "啟動 backend ..."
$env:VBPL_HOME = $AppDir
try {
  & bun run "$AppDir\cli\vbpl.ts" server start
} catch {
  Err "server start 失敗,可手動跑:vbpl server start"
}

Info ""
Info "OK Installed $Tag at $AppDir"
Info "OK Backend: http://localhost:3001"
Info ""
Info "Done. 跑 ``vbpl --help`` 看指令。"
