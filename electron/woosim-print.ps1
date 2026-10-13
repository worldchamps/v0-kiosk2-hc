param([string]$PrinterName = "", [switch]$CheckOnly)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WoosimRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name = "Property3 B Woosim Receipt";
    [MarshalAs(UnmanagedType.LPWStr)] public string Output = null;
    [MarshalAs(UnmanagedType.LPWStr)] public string Type = "RAW";
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern int StartDocPrinter(IntPtr printer, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool AbortPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr printer);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Send(string name, byte[] bytes) {
    IntPtr printer; Check(OpenPrinter(name, out printer, IntPtr.Zero));
    bool started = false, completed = false;
    try {
      Check(StartDocPrinter(printer, 1, new DocInfo()) > 0); started = true;
      Check(StartPagePrinter(printer));
      int written; Check(WritePrinter(printer, bytes, bytes.Length, out written));
      if (written != bytes.Length) throw new InvalidOperationException("Incomplete RAW receipt write; do not retry automatically");
      Check(EndPagePrinter(printer)); Check(EndDocPrinter(printer)); completed = true;
    } finally {
      if (started && !completed) AbortPrinter(printer);
      ClosePrinter(printer);
    }
  }
}
'@


# Woosim Command Manual v2.6 pp.11-12: ESC t 255 selects the installed DBCS font.
# https://woosim.com/upload/catalog_20151030173214_949835.pdf
# Korean firmware must have the KS C 5601 font installed. Never silently replace glyphs.
$encoding = [System.Text.Encoding]::GetEncoding(949, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
$job = [System.Collections.Generic.List[byte]]::new()
$job.AddRange([byte[]]@(0x1b, 0x40, 0x1b, 0x74, 255, 0x1b, 0x21, 0))

function Add-Feed([double]$Mm) {
  if ([double]::IsNaN($Mm) -or [double]::IsInfinity($Mm) -or $Mm -lt 0 -or $Mm -gt 30) { throw "Invalid receipt spacing." }
  $dots = [int][Math]::Round($Mm * 8)
  if ($dots -gt 0) { $job.AddRange([byte[]]@(0x1b, 0x4a, $dots)) }
}

function Wrap-Text([string]$Text, [int]$Columns) {
  if ($Text -match '[\x00-\x09\x0b-\x1f\x7f]') { throw "Control character in receipt text." }
  $line = ""; $width = 0
  foreach ($character in $Text.ToCharArray()) {
    $count = $encoding.GetByteCount([string]$character)
    if ($width + $count -gt $Columns) { $line; $line = ""; $width = 0 }
    $line += $character; $width += $count
  }
  $line
}

function Add-Line([string]$Text, [int]$Align, [int]$Scale, [bool]$Bold, [bool]$Underline) {
  # ESC a / E / - / 3, GS ! apply to the native text; 24-dot Korean and 12-dot ASCII.
  $job.AddRange([byte[]]@(0x1b, 0x61, $Align, 0x1b, 0x45, [int]$Bold, 0x1b, 0x2d, [int]$Underline,
    0x1d, 0x21, (($Scale-1)*17), 0x1b, 0x33, (24*$Scale+4)))
  $job.AddRange($encoding.GetBytes($Text))
  $job.Add(10)
}

$payload = if ([Console]::IsInputRedirected) { [Console]::In.ReadToEnd().Trim() } else { "" }
if ($payload) {
  $parsed = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
  $commands = @($parsed | ForEach-Object { $_ })
} elseif ($CheckOnly) {
  $commands = @(
    [pscustomobject]@{text = ([string][char]0xD55C) + ([string][char]0xAE00) + " B101"; size = 22; bold = $true; align = "center"},
    [pscustomobject]@{kind = "columns"; left = "ROOM"; right = "B 101"; size = 11}
  )
} else { throw "Receipt payload is empty." }
if ($commands.Count -eq 0 -or $commands.Count -gt 200) { throw "Invalid receipt command count." }
Add-Feed 4
foreach ($line in $commands) {
  if ($null -ne $line.gapBefore) { Add-Feed ([double]$line.gapBefore) }
  if ($line.kind -eq "separator") {
    Add-Line ("-" * 48) 0 1 $false $false
  } else {
    $size = if ($null -eq $line.size) { 10.5 } else { [double]$line.size }
    if ([double]::IsNaN($size) -or [double]::IsInfinity($size) -or $size -lt 1 -or $size -gt 40) { throw "Invalid text size." }
    $scale = [int][Math]::Max(1, [Math]::Min(4, [Math]::Round($size * 203 / 72 / 24)))
    $columns = [int][Math]::Floor(48 / $scale)
    $align = if ($line.align -eq "center") { 1 } elseif ($line.align -eq "right") { 2 } else { 0 }
    if ($line.kind -eq "columns") {
      $left = [string]$line.left; $right = [string]$line.right
      $leftWidth = $encoding.GetByteCount($left)
      if ($leftWidth -ge $columns - 2 -or $left -match '[\x00-\x1f\x7f]' -or $right -match '[\x00-\x1f\x7f]') { throw "Invalid receipt columns." }
      $first = $true
      foreach ($part in @(Wrap-Text $right ($columns-$leftWidth-2))) {
        $label = if ($first) { $left } else { "" }
        $padding = $columns-$encoding.GetByteCount($label)-$encoding.GetByteCount($part)
        Add-Line ($label + (" " * $padding) + $part) 0 $scale ([bool]$line.bold) ([bool]$line.underline)
        $first = $false
      }
    } else {
      foreach ($paragraph in ([string]$line.text).Replace("`r`n", "`n").Split([char]10)) {
        foreach ($part in @(Wrap-Text $paragraph $columns)) { Add-Line $part $align $scale ([bool]$line.bold) ([bool]$line.underline) }
      }
    }
  }
  if ($null -ne $line.gapAfter) { Add-Feed ([double]$line.gapAfter) }
}
$feedMm = if ([string]::IsNullOrWhiteSpace($env:WOOSIM_CUT_FEED_MM)) { 12.0 } else {
  [double]::Parse($env:WOOSIM_CUT_FEED_MM, [System.Globalization.CultureInfo]::InvariantCulture)
}
Add-Feed $feedMm
$job.AddRange([byte[]]@(0x1d, 0x56, 0)) # GS V 0: one full cut in the same RAW job, manual p.60.
$bytes = $job.ToArray()
if ($CheckOnly) {
  $korean = $encoding.GetBytes(([string][char]0xD55C)+([string][char]0xAE00))
  if ([BitConverter]::ToString($korean) -ne 'C7-D1-B1-DB') { throw "CP949 encoding failed." }
  $cuts = 0
  for ($i=0; $i -lt $bytes.Length-2; $i++) {
    if ($bytes[$i] -eq 29 -and $bytes[$i+1] -eq 86 -and $bytes[$i+2] -eq 0) { $cuts++ }
  }
  if ($cuts -ne 1) { throw "Receipt must cut exactly once." }
  [Console]::Out.WriteLine("WOOSIM RAW self-check passed: bytes=$($bytes.Length) cut=1 cp949=C7-D1-B1-DB (no printer opened)")
  [Console]::Out.WriteLine([Convert]::ToBase64String($bytes))
} else {
  if ([string]::IsNullOrWhiteSpace($PrinterName)) { throw "PrinterName is required." }
  [WoosimRaw]::Send($PrinterName, $bytes)
  [Console]::Out.WriteLine("WOOSIM CP949 text + single cut queued as one RAW job (physical output unverified)")
}
