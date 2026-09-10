$ErrorActionPreference = 'Stop'
$repairRoot = Split-Path -Parent $PSScriptRoot
$repairOut = Join-Path $repairRoot '.local/property3-a-repair-v2'
New-Item -ItemType Directory -Force -Path $repairOut | Out-Null
$repairCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
foreach ($repairArch in @('x86', 'x64')) {
    & $repairCompiler /nologo /target:winexe "/platform:$repairArch" /optimize+ /codepage:65001 /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Core.dll "/resource:$repairRoot\ops\repair\property3-a.cjs,repair.cjs" "/out:$repairOut\Property3-A-Repair-v2-$repairArch.exe" "$repairRoot\ops\repair\KioskRepair.cs"
    if ($LASTEXITCODE -ne 0) { throw "Repair build failed: $repairArch" }
}
Get-FileHash -Algorithm SHA256 -LiteralPath "$repairOut/Property3-A-Repair-v2-x86.exe", "$repairOut/Property3-A-Repair-v2-x64.exe"
