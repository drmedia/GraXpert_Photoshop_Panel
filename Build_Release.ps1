[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$SkipTests,
    [switch]$RunPhotoshopIntegration
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$projectRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot 'dist'
}

function Assert-FileExists {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file was not found: $Path"
    }
}

function Assert-DirectoryExists {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Required directory was not found: $Path"
    }
}

function Assert-TextContains {
    param(
        [string]$Path,
        [string]$Expected
    )
    Assert-FileExists $Path
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($content.IndexOf($Expected, [StringComparison]::Ordinal) -lt 0) {
        throw "Version text mismatch in $Path. Expected: $Expected"
    }
}

function Get-NormalizedFullPath {
    param([string]$Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-DirectChildPath {
    param(
        [string]$Parent,
        [string]$Child
    )
    $parentPath = Get-NormalizedFullPath $Parent
    $childPath = Get-NormalizedFullPath $Child
    $expectedPrefix = $parentPath + [IO.Path]::DirectorySeparatorChar
    if (-not $childPath.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the release output directory: $childPath"
    }
    if ([IO.Path]::GetDirectoryName($childPath) -ne $parentPath) {
        throw "Release temporary path must be a direct child of the output directory: $childPath"
    }
}

$manifestPath = Join-Path $projectRoot 'GraXpert-Photoshop-Panel\CSXS\manifest.xml'
Assert-FileExists $manifestPath
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$version = [string]$manifest.ExtensionManifest.ExtensionBundleVersion
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid ExtensionBundleVersion in manifest.xml: $version"
}

$versionChecks = @(
    @{ Path = 'README.md'; Expected = "**v$version**" },
    @{ Path = 'README_KO.txt'; Expected = "GraXpert Photoshop Panel v$version" },
    @{ Path = 'USER_GUIDE_KO.txt'; Expected = "GraXpert Photoshop Panel v$version" },
    @{ Path = 'Install_Windows.bat'; Expected = "GraXpert Photoshop Panel Installer v$version" },
    @{ Path = 'Uninstall_Windows.bat'; Expected = "GraXpert Photoshop Panel Uninstaller v$version" },
    @{ Path = 'GraXpert-Photoshop-Panel\client\index.html'; Expected = "v$version" }
)
foreach ($check in $versionChecks) {
    Assert-TextContains (Join-Path $projectRoot $check.Path) $check.Expected
}
$indexPath = Join-Path $projectRoot 'GraXpert-Photoshop-Panel\client\index.html'
$indexContent = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
$indexVersionCount = [regex]::Matches($indexContent, [regex]::Escape("v$version")).Count
if ($indexVersionCount -lt 3) {
    throw "Version text mismatch in $indexPath. Expected at least 3 occurrences of v$version."
}

$requiredFiles = @(
    'Install_Windows.bat',
    'Uninstall_Windows.bat',
    'Diagnose_Install.bat',
    'Build_Release.ps1',
    'README.md',
    'README_KO.txt',
    'USER_GUIDE_KO.txt',
    'LICENSE'
)
$requiredDirectories = @(
    'GraXpert-Photoshop-Panel',
    'docs'
)
foreach ($relativePath in $requiredFiles) {
    Assert-FileExists (Join-Path $projectRoot $relativePath)
}
foreach ($relativePath in $requiredDirectories) {
    Assert-DirectoryExists (Join-Path $projectRoot $relativePath)
}

if (-not $SkipTests) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw 'Node.js was not found. Install Node.js or use -SkipTests intentionally.'
    }
    Write-Host '[1/4] Running Node tests...'
    & $nodeCommand.Source (Join-Path $projectRoot 'tests\run-tests.js')
    if ($LASTEXITCODE -ne 0) {
        throw "Node tests failed with exit code $LASTEXITCODE."
    }
} else {
    Write-Host '[1/4] Skipping Node tests by request.'
}

if ($RunPhotoshopIntegration) {
    $integrationScript = Join-Path $projectRoot 'tests\Run_Photoshop_Integration.ps1'
    Assert-FileExists $integrationScript
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Assert-FileExists $windowsPowerShell
    Write-Host '[2/4] Running Photoshop integration tests...'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $integrationScript
    if ($LASTEXITCODE -ne 0) {
        throw "Photoshop integration tests failed with exit code $LASTEXITCODE."
    }
} else {
    Write-Host '[2/4] Photoshop integration tests were not requested.'
}

$outputRoot = Get-NormalizedFullPath $OutputDirectory
if (-not (Test-Path -LiteralPath $outputRoot)) {
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
}
Assert-DirectoryExists $outputRoot

$releaseName = "GraXpert-Photoshop-Panel-v$version-win"
$stagingRoot = Join-Path $outputRoot ('.release-staging-' + $releaseName + '-' + $PID)
$packageRoot = Join-Path $stagingRoot $releaseName
$zipPath = Join-Path $outputRoot ($releaseName + '.zip')
$checksumPath = $zipPath + '.sha256'
Assert-DirectChildPath $outputRoot $stagingRoot
Assert-DirectChildPath $outputRoot $zipPath
Assert-DirectChildPath $outputRoot $checksumPath

Write-Host '[3/4] Creating release archive...'
try {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

    foreach ($relativePath in $requiredFiles) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination (Join-Path $packageRoot $relativePath)
    }
    foreach ($relativePath in $requiredDirectories) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination (Join-Path $packageRoot $relativePath) -Recurse
    }

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    if (Test-Path -LiteralPath $checksumPath) {
        Remove-Item -LiteralPath $checksumPath -Force
    }
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
} finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Assert-FileExists $zipPath
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $archivePrefix = $releaseName + '/'
    $archiveRequired = @(
        ($archivePrefix + 'Install_Windows.bat'),
        ($archivePrefix + 'LICENSE'),
        ($archivePrefix + 'GraXpert-Photoshop-Panel/CSXS/manifest.xml'),
        ($archivePrefix + 'GraXpert-Photoshop-Panel/client/main.js'),
        ($archivePrefix + 'GraXpert-Photoshop-Panel/host/host.jsx')
    )
    foreach ($entry in $archiveRequired) {
        if ($entryNames -notcontains $entry) {
            throw "Release archive verification failed; missing entry: $entry"
        }
    }
} finally {
    $archive.Dispose()
}

Write-Host '[4/4] Writing SHA-256 checksum...'
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
$checksumLine = $hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($zipPath)
Set-Content -LiteralPath $checksumPath -Value $checksumLine -Encoding ASCII

Write-Host ''
Write-Host '[OK] Release package created.'
Write-Host ('Version:  ' + $version)
Write-Host ('Archive:  ' + $zipPath)
Write-Host ('SHA-256: ' + $hash.Hash.ToLowerInvariant())
Write-Host ('Checksum: ' + $checksumPath)
