$ErrorActionPreference = 'Stop'

$projectPath = Split-Path -Parent $PSScriptRoot
$testPath = Join-Path $PSScriptRoot 'Photoshop_Integration_Test.jsx'
$reportPath = Join-Path $PSScriptRoot 'Photoshop_Integration_Result.txt'
$floatInputPath = Join-Path $PSScriptRoot 'GraXpert_Integration_Float32_Input.tif'
$floatResultPath = Join-Path $PSScriptRoot 'GraXpert_Integration_Float32_Result.tif'
$nodeTestPath = Join-Path $PSScriptRoot 'run-tests.js'
$scriptBody = Get-Content -LiteralPath $testPath -Raw -Encoding UTF8
$javascriptPath = $projectPath.Replace('\', '/')
$scriptCode = 'var GX_TEST_PROJECT_PATH = "' + $javascriptPath + '";' + [Environment]::NewLine + $scriptBody
$wasRunning = @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue).Count -gt 0
$photoshop = New-Object -ComObject Photoshop.Application

try {
    $photoshop.Visible = $true
    $hostPath = (Join-Path $projectPath 'GraXpert-Photoshop-Panel\host\host.jsx').Replace('\', '/')
    $floatInputJsPath = $floatInputPath.Replace('\', '/')
    $prepareCode = @"
app.displayDialogs = DialogModes.NO;
`$.evalFile(new File("$hostPath"));
var gxProfileDocument = app.documents.add(32, 32, 72, "GX_ICC_SOURCE", NewDocumentMode.RGB, DocumentFill.WHITE);
gxProfileDocument.bitsPerChannel = BitsPerChannelType.THIRTYTWO;
var gxColor = new SolidColor();
gxColor.rgb.red = 76.5; gxColor.rgb.green = 51; gxColor.rgb.blue = 25.5;
gxProfileDocument.selection.selectAll();
gxProfileDocument.selection.fill(gxColor, ColorBlendMode.NORMAL, 100, false);
gxProfileDocument.selection.deselect();
var gxExportResult = GX_exportInput("$floatInputJsPath", "layer", "layer-auto", true);
gxProfileDocument.close(SaveOptions.DONOTSAVECHANGES);
gxExportResult;
"@
    $exportResult = [string]$photoshop.DoJavaScript($prepareCode, $null, 1)
    if ($exportResult -notmatch '^OK\|') {
        throw 'Photoshop 32-bit ICC TIFF export failed: ' + $exportResult
    }
    $fixtureOutput = & node $nodeTestPath --neutralize-existing-tiff $floatInputPath $floatResultPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $floatResultPath)) {
        throw '32-bit Neutralise TIFF processing failed: ' + ($fixtureOutput -join [Environment]::NewLine)
    }
    $null = $photoshop.DoJavaScript($scriptCode, $null, 1)
} finally {
    if (-not $wasRunning) {
        try { $photoshop.Quit() } catch { Write-Warning $_.Exception.Message }
    }
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($photoshop) | Out-Null
    Remove-Item -LiteralPath $floatInputPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $floatResultPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $reportPath)) {
    throw 'Photoshop integration result was not created.'
}

$report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8
Write-Output $report.TrimEnd()

if ($report -notmatch '(?m)^Result: PASS\r?$') {
    exit 1
}
