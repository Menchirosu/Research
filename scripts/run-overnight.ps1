param(
  [string]$Topic = "hot AI coding workflows right now",
  [string]$WatchlistFile = "config/threads-watchlist.json",
  [string]$SeededPostsFile = "config/seeded-posts.json",
  [switch]$StretchBudget,
  [switch]$AllowOlderTarget
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$args = @(
  "src/cli.js",
  "overnight",
  "--topic=$Topic",
  "--watchlist-file=$WatchlistFile",
  "--seeded-posts-file=$SeededPostsFile"
)

if ($StretchBudget) {
  $args += "--stretch-budget"
}

if ($AllowOlderTarget) {
  $args += "--allow-older-target"
}

node @args
