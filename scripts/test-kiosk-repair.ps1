#requires -Version 7.0
param([string]$PackageRoot = 'dist')
$ErrorActionPreference = 'Stop'
$repairRoot = Split-Path -Parent $PSScriptRoot
$repairPackages = (Resolve-Path $PackageRoot).Path
$repairCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$repairOut = Join-Path $repairRoot '.local\property3-a-repair-v2'
New-Item -ItemType Directory -Force -Path $repairOut | Out-Null
$repairOldMode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
function Invoke-RepairTestProcess([string]$Runtime, [string]$Arguments) {
    # Retain the actual process handle; Windows PowerShell Start-Process can
    # report a null ExitCode for this short-lived GUI-subsystem executable.
    $repairStart = New-Object System.Diagnostics.ProcessStartInfo
    $repairStart.FileName = $Runtime
    $repairStart.Arguments = $Arguments
    $repairStart.UseShellExecute = $false
    $repairStart.CreateNoWindow = $true
    $repairStart.RedirectStandardOutput = $true
    $repairStart.RedirectStandardError = $true
    $repairChild = [System.Diagnostics.Process]::Start($repairStart)
    try {
        $repairStdout = $repairChild.StandardOutput.ReadToEndAsync()
        $repairStderr = $repairChild.StandardError.ReadToEndAsync()
        if (!$repairChild.WaitForExit(15000)) { $repairChild.Kill(); throw 'Repair test process timed out' }
        if ($repairChild.ExitCode -ne 0) { throw "Repair test process failed: $($repairChild.ExitCode)" }
        if ($repairStdout.Result.Trim()) { Write-Output $repairStdout.Result.Trim() }
    } finally { $repairChild.Dispose() }
}
try {
    foreach ($repairArch in @('x64', 'ia32')) {
        Write-Output "Testing synthetic repair: $repairArch"
        $repairPlatform = if ($repairArch -eq 'ia32') { 'x86' } else { 'x64' }
        $repairUnpacked = if ($repairArch -eq 'ia32') { 'win-ia32-unpacked' } else { 'win-unpacked' }
        $repairExe = Join-Path $repairPackages "$repairArch\$repairUnpacked\TheBeachStay Kiosk.exe"
        if (!(Test-Path -LiteralPath $repairExe)) { throw "Packaged runtime missing: $repairArch" }
        $env:KIOSK_REPAIR_TEST_DIR = Join-Path ([IO.Path]::GetTempPath()) ('kiosk-repair-interop-' + [char]0xD55C + [char]0xAE00 + ' ' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $env:KIOSK_REPAIR_TEST_DIR | Out-Null
        $env:KIOSK_REPAIR_TEST_ARCH = $repairArch
        $env:KIOSK_REPAIR_TEST_VERIFY = '0'
        $repairFixture = Join-Path $repairRoot 'ops\repair\electron-fixture.cjs'
        $repairElectron = Join-Path $repairRoot 'node_modules\electron\dist\electron.exe'
        Invoke-RepairTestProcess $repairElectron ('"' + $repairFixture + '"')
        $repairTest = Join-Path $repairOut "interop-$repairPlatform.exe"
        & $repairCompiler /nologo /target:exe "/platform:$repairPlatform" /main:InteropTest /codepage:65001 /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Core.dll "/resource:$repairRoot\ops\repair\property3-a.cjs,repair.cjs" "/out:$repairTest" "$repairRoot\ops\repair\KioskRepair.cs" "$repairRoot\ops\repair\InteropTest.cs"
        if ($LASTEXITCODE -ne 0) { throw 'Interop compilation failed' }
        Invoke-RepairTestProcess $repairTest ('"' + $repairExe + '" "' + $env:KIOSK_REPAIR_TEST_DIR + '"')
        $env:KIOSK_REPAIR_TEST_VERIFY = '1'
        Invoke-RepairTestProcess $repairElectron ('"' + $repairFixture + '"')
        if ((Get-Content -LiteralPath (Join-Path $env:KIOSK_REPAIR_TEST_DIR 'verified.txt') -Raw) -ne 'ELECTRON_SAFE_STORAGE_ROUNDTRIP_PASS') { throw 'Missing verification report' }
        Write-Output "PASS: $repairArch packaged Electron + DPAPI + original registration/settings + encrypted backup"
    }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $repairOldMode
    Remove-Item Env:KIOSK_REPAIR_TEST_DIR, Env:KIOSK_REPAIR_TEST_ARCH, Env:KIOSK_REPAIR_TEST_VERIFY -ErrorAction SilentlyContinue
}
