param([string]$PrinterName = "", [switch]$CheckOnly)

# Share Korean GDI drawing only. SAM4S's PrintDocument/driver path remains separate.
. (Join-Path $PSScriptRoot "sam4s-print.ps1") -FunctionsOnly -CheckOnly:$CheckOnly -PrinterName $PrinterName
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
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
  public static int BlackPixels;
  public static byte[] Build(Bitmap image, int feedDots) {
    if (image.Width != 576 || image.Height < 1 || image.Height > 8000 || feedDots < 0 || feedDots > 240)
      throw new ArgumentException("Invalid Woosim receipt dimensions/feed");
    var job = new List<byte>();
    job.AddRange(new byte[] {0x1b, 0x40, 0x1b, 0x33, 24}); // Init; 24-dot line spacing.
    BlackPixels = 0;
    for (int y = 0; y < image.Height; y += 24) {
      job.AddRange(new byte[] {0x1b, 0x2a, 33, 0x40, 0x02}); // ESC *: 576 columns, 24-dot double density.
      for (int x = 0; x < 576; x++) for (int octet = 0; octet < 3; octet++) {
        byte value = 0;
        for (int bit = 0; bit < 8; bit++) {
          int row = y + octet * 8 + bit;
          if (row < image.Height && image.GetPixel(x, row).R < 128) {
            value |= (byte)(0x80 >> bit); BlackPixels++;
          }
        }
        job.Add(value);
      }
      job.Add(0x0a);
    }
    if (feedDots > 0) job.AddRange(new byte[] {0x1b, 0x4a, (byte)feedDots});
    job.AddRange(new byte[] {0x1d, 0x56, 0x00}); // Full cut once; never a separate auto-retried job.
    return job.ToArray();
  }
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

if ($CheckOnly) {
  $commands = @(
    [pscustomobject]@{text = ([string][char]0xD55C) + ([string][char]0xAE00) + " B101"; size = 22; bold = $true; align = "center"},
    [pscustomobject]@{kind = "columns"; left = "ROOM"; right = "B 101"; size = 11}
  )
} else {
  if ([string]::IsNullOrWhiteSpace($PrinterName)) { throw "PrinterName is required." }
  $commands = @(Convert-ReceiptCommands ([Console]::In.ReadToEnd().Trim()))
  if ($commands.Count -eq 0) { throw "Receipt commands are empty." }
}
$feedMm = if ([string]::IsNullOrWhiteSpace($env:WOOSIM_CUT_FEED_MM)) { 12.0 } else {
  [double]::Parse($env:WOOSIM_CUT_FEED_MM, [System.Globalization.CultureInfo]::InvariantCulture)
}
if ([double]::IsNaN($feedMm) -or $feedMm -lt 0 -or $feedMm -gt 30) { throw "WOOSIM_CUT_FEED_MM must be 0..30." }
# Measure content first; never use a driver's default A4 page length.
$measure = [System.Drawing.Bitmap]::new(576, 1)
$measure.SetResolution(203, 203)
$graphics = [System.Drawing.Graphics]::FromImage($measure)
try { $heightMm = Draw-Receipt $graphics $commands 0 0 64 }
finally { $graphics.Dispose(); $measure.Dispose() }
$height = [int][Math]::Ceiling(($heightMm + 2) * 203 / 25.4)
if ($height -lt 1 -or $height -gt 8000) { throw "Woosim receipt is too long." }
$bitmap = [System.Drawing.Bitmap]::new(576, $height)
$bitmap.SetResolution(203, 203)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $null = Draw-Receipt $graphics $commands 0 0 64
  $job = [WoosimRaw]::Build($bitmap, [int][Math]::Round($feedMm * 203 / 25.4))
  if ($CheckOnly) {
    $bands = [int][Math]::Ceiling($height / 24.0)
    $index = 5
    for ($band = 0; $band -lt $bands; $band++) {
      if ($job[$index] -ne 0x1b -or $job[$index+1] -ne 0x2a -or $job[$index+2] -ne 33 -or
          $job[$index+3] -ne 0x40 -or $job[$index+4] -ne 2 -or $job[$index+1733] -ne 10) { throw "Invalid image band." }
      $index += 1734
    }
    if ($feedMm -gt 0) { $index += 3 }
    if ($job.Length -ne $index + 3 -or $job[$index] -ne 0x1d -or $job[$index+1] -ne 0x56 -or $job[$index+2] -ne 0 -or
        [WoosimRaw]::BlackPixels -lt 100) { throw "Blank image or missing single cut." }
    # Exercise orientation, band boundaries and white padding with known pixels.
    $tiny = [System.Drawing.Bitmap]::new(576, 25)
    $tinyGraphics = [System.Drawing.Graphics]::FromImage($tiny)
    try {
      $tinyGraphics.Clear([System.Drawing.Color]::White)
      foreach ($row in @(0, 7, 8, 23, 24)) { $tiny.SetPixel(0, $row, [System.Drawing.Color]::Black) }
      $known = [WoosimRaw]::Build($tiny, 0)
      if ($known[10] -ne 129 -or $known[11] -ne 128 -or $known[12] -ne 1 -or
          $known[1744] -ne 128 -or $known[1745] -ne 0 -or $known.Length -ne 3476) { throw "Bit-image orientation failed." }
    } finally { $tinyGraphics.Dispose(); $tiny.Dispose() }
    [Console]::Out.WriteLine("WOOSIM RAW self-check passed: bands=$bands bytes=$($job.Length) cut=1 (no printer opened)")
  } else {
    [WoosimRaw]::Send($PrinterName, $job)
    [Console]::Out.WriteLine("WOOSIM image + single cut queued as one RAW job (physical output unverified)")
  }
} finally { $graphics.Dispose(); $bitmap.Dispose() }
