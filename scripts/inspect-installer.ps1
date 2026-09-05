param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = "Stop"
$installer = Get-Item -LiteralPath $InstallerPath
[ordered]@{
  productVersion = $installer.VersionInfo.ProductVersion
  productName = $installer.VersionInfo.ProductName
} | ConvertTo-Json -Compress
