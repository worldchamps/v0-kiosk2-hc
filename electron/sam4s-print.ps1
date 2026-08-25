param(
  [string]$PrinterName = "",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Drawing

function Convert-ReceiptCommands([string]$Encoded) {
  if ([string]::IsNullOrWhiteSpace($Encoded)) { throw "Receipt payload is empty." }
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Encoded))
  $parsedCommands = $json | ConvertFrom-Json
  foreach ($command in $parsedCommands) { $command }
}

function New-ReceiptFormat([string]$Alignment) {
  $format = [System.Drawing.StringFormat]::new()
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Trimming = [System.Drawing.StringTrimming]::None
  if ($Alignment -eq "center") {
    $format.Alignment = [System.Drawing.StringAlignment]::Center
  } elseif ($Alignment -eq "right") {
    $format.Alignment = [System.Drawing.StringAlignment]::Far
  } else {
    $format.Alignment = [System.Drawing.StringAlignment]::Near
  }
  return $format
}

function Draw-Receipt($Graphics, $Commands) {
  $Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $y = 4.0
  $x = 4.0
  $width = 72.0

  foreach ($line in $Commands) {
    if ($null -ne $line.gapBefore) { $y += [double]$line.gapBefore }
    $kind = if ($line.kind) { [string]$line.kind } else { "text" }

    if ($kind -eq "separator") {
      $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, [single]0.25)
      try {
        $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
        $Graphics.DrawLine($pen, [single]$x, [single]$y, [single]($x + $width), [single]$y)
      } finally {
        $pen.Dispose()
      }
      $y += 0.5
    } else {
      $fontSize = if ($line.size) { [single]$line.size } else { [single]10.5 }
      $fontStyle = [System.Drawing.FontStyle]::Regular
      if ($line.bold -eq $true) { $fontStyle = $fontStyle -bor [System.Drawing.FontStyle]::Bold }
      if ($line.underline -eq $true) { $fontStyle = $fontStyle -bor [System.Drawing.FontStyle]::Underline }
      $font = [System.Drawing.Font]::new("Malgun Gothic", $fontSize, $fontStyle, [System.Drawing.GraphicsUnit]::Point)

      try {
        if ($kind -eq "columns") {
          $leftFormat = New-ReceiptFormat "left"
          $rightFormat = New-ReceiptFormat "right"
          try {
            $leftWidth = 23.0
            $rightX = $x + 25.0
            $rightWidth = 47.0
            $leftText = [string]$line.left
            $rightText = [string]$line.right
            $leftSize = $Graphics.MeasureString($leftText, $font, [System.Drawing.SizeF]::new([single]$leftWidth, [single]1000), $leftFormat)
            $rightSize = $Graphics.MeasureString($rightText, $font, [System.Drawing.SizeF]::new([single]$rightWidth, [single]1000), $rightFormat)
            $height = [Math]::Max([double]$leftSize.Height, [double]$rightSize.Height)
            $Graphics.DrawString($leftText, $font, [System.Drawing.Brushes]::Black, [System.Drawing.RectangleF]::new([single]$x, [single]$y, [single]$leftWidth, [single]$height), $leftFormat)
            $Graphics.DrawString($rightText, $font, [System.Drawing.Brushes]::Black, [System.Drawing.RectangleF]::new([single]$rightX, [single]$y, [single]$rightWidth, [single]$height), $rightFormat)
            $y += $height
          } finally {
            $leftFormat.Dispose()
            $rightFormat.Dispose()
          }
        } else {
          $format = New-ReceiptFormat ([string]$line.align)
          try {
            $value = [string]$line.text
            $measured = $Graphics.MeasureString($value, $font, [System.Drawing.SizeF]::new([single]$width, [single]1000), $format)
            $height = [Math]::Max([double]$measured.Height, [double]($fontSize * 0.48))
            $Graphics.DrawString($value, $font, [System.Drawing.Brushes]::Black, [System.Drawing.RectangleF]::new([single]$x, [single]$y, [single]$width, [single]$height), $format)
            $y += $height
          } finally {
            $format.Dispose()
          }
        }
      } finally {
        $font.Dispose()
      }
    }

    if ($null -ne $line.gapAfter) { $y += [double]$line.gapAfter }
  }
  return $y
}

if ($CheckOnly) {
  $sample = ([string][char]0xD55C) + ([string][char]0xAE00) + " SAM4S 1234"
  $sampleCommands = @(
    [pscustomobject]@{ kind = "text"; text = $sample; size = 22; bold = $true; align = "center"; gapAfter = 2 },
    [pscustomobject]@{ kind = "columns"; left = "ROOM"; right = "CAMP 101"; size = 11 },
    [pscustomobject]@{ kind = "separator"; gapBefore = 1; gapAfter = 1 }
  )
  $sampleJson = ConvertTo-Json -InputObject $sampleCommands -Depth 5 -Compress
  $sampleEncoded = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($sampleJson))
  $commands = @(Convert-ReceiptCommands $sampleEncoded)
  if ($commands.Count -ne 3) { throw "Receipt command array was not flattened." }
  $bitmap = [System.Drawing.Bitmap]::new(640, 1000)
  $bitmap.SetResolution(203, 203)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $height = Draw-Receipt $graphics $commands
    $darkPixels = 0
    for ($pixelY = 0; $pixelY -lt 500; $pixelY += 2) {
      for ($pixelX = 0; $pixelX -lt 640; $pixelX += 2) {
        if ($bitmap.GetPixel($pixelX, $pixelY).R -lt 200) { $darkPixels += 1 }
      }
    }
    if ($height -lt 10 -or $darkPixels -lt 100) { throw "GDI receipt render was blank." }
    [Console]::Out.WriteLine("SAM4S GDI self-check passed: height=$([Math]::Round($height, 1))mm darkPixels=$darkPixels")
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PrinterName)) { throw "PrinterName is required." }
$encoded = [Console]::In.ReadToEnd().Trim()
$commands = @(Convert-ReceiptCommands $encoded)
if ($commands.Count -eq 0) { throw "Receipt commands are empty." }

$document = [System.Drawing.Printing.PrintDocument]::new()
try {
  $document.PrinterSettings.PrinterName = $PrinterName
  if (-not $document.PrinterSettings.IsValid) { throw "Printer is not valid: $PrinterName" }
  $document.DocumentName = "Property4 SAM4S Receipt"
  $document.PrintController = [System.Drawing.Printing.StandardPrintController]::new()
  $document.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(0, 0, 0, 0)
  $document.OriginAtMargins = $false
  $script:Sam4sCommands = $commands
  $document.add_PrintPage({
    param($sender, $eventArgs)
    $null = Draw-Receipt $eventArgs.Graphics $script:Sam4sCommands
    $eventArgs.HasMorePages = $false
  })
  $document.Print()
  [Console]::Out.WriteLine("GDI print job completed")
} finally {
  $document.Dispose()
}
