param(
  [string]$Topic = "hot AI coding workflows right now",
  [string]$TargetsFile = "config/overnight-targets.json",
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
  "--targets-file=$TargetsFile"
)

if ($StretchBudget) {
  $args += "--stretch-budget"
}

if ($AllowOlderTarget) {
  $args += "--allow-older-target"
}

node @args
