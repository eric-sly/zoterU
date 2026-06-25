param(
	[string]$OutputDir
)

$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $sourceDir "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

if (-not $OutputDir) {
	$projectRoot = Split-Path -Parent $sourceDir
	$rootXpiDir = Join-Path $projectRoot "xpi"
	if (Test-Path -LiteralPath $rootXpiDir) {
		$OutputDir = $rootXpiDir
	}
	else {
		$OutputDir = $sourceDir
	}
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$xpiPath = Join-Path $OutputDir "zoterU-$version.xpi"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("zoteru-xpi-" + [System.Guid]::NewGuid().ToString("N"))

$packageItems = @(
	"bootstrap.js",
	"bridge.js",
	"manifest.json",
	"preferences.xhtml",
	"preferences.js",
	"preferences.css",
	"prefs.js",
	"icon.svg",
	"locale",
	"mcp-bridge.js"
)

try {
	New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
	foreach ($item in $packageItems) {
		Copy-Item -LiteralPath (Join-Path $sourceDir $item) -Destination $tempDir -Recurse -Force
	}

	if (Test-Path -LiteralPath $xpiPath) {
		Remove-Item -LiteralPath $xpiPath -Force
	}

	$zipPath = [System.IO.Path]::ChangeExtension($xpiPath, ".zip")
	if (Test-Path -LiteralPath $zipPath) {
		Remove-Item -LiteralPath $zipPath -Force
	}

	Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $zipPath -Force
	Move-Item -LiteralPath $zipPath -Destination $xpiPath -Force
	Write-Host "Built $xpiPath"
}
finally {
	if (Test-Path -LiteralPath $tempDir) {
		Remove-Item -LiteralPath $tempDir -Recurse -Force
	}
}
