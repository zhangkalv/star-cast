# Generate app icon assets from LOGO.png:
#   resources/logo.ico  (multi-size PNG-embedded ICO, for exe/installer)
#   resources/logo.png  (window icon)
#   src/renderer/src/assets/logo.png  (UI logo)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'LOGO.png'
$resDir = Join-Path $root 'resources'
$assetsDir = Join-Path $root 'src\renderer\src\assets'
New-Item -ItemType Directory -Force -Path $resDir, $assetsDir | Out-Null

Add-Type -AssemblyName System.Drawing

Copy-Item $src (Join-Path $assetsDir 'logo.png') -Force
Copy-Item $src (Join-Path $resDir 'logo.png') -Force

function Get-ResizedPngBytes {
    param([int]$Size)
    $img = [System.Drawing.Image]::FromFile($src)
    try {
        $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
        try {
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode = 'HighQualityBicubic'
                $g.SmoothingMode = 'HighQuality'
                $g.PixelOffsetMode = 'HighQuality'
                $g.DrawImage($img, 0, 0, $Size, $Size)
            } finally { $g.Dispose() }
            $ms = New-Object System.IO.MemoryStream
            try {
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                return $ms.ToArray()
            } finally { $ms.Dispose() }
        } finally { $bmp.Dispose() }
    } finally { $img.Dispose() }
}

$sizes = @(256, 48, 32, 16)
$entries = @()
foreach ($s in $sizes) {
    $bytes = Get-ResizedPngBytes -Size $s
    $entries += ,@($s, $bytes)
}

$count = $entries.Count
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)    # reserved
$bw.Write([uint16]1)    # type: icon
$bw.Write([uint16]$count)
$offset = 6 + 16 * $count
foreach ($e in $entries) {
    $size = [int]$e[0]
    $bytes = [byte[]]$e[1]
    $dim = if ($size -ge 256) { [byte]0 } else { [byte]$size }
    $bw.Write($dim)
    $bw.Write($dim)
    $bw.Write([byte]0)     # palette count
    $bw.Write([byte]0)     # reserved
    $bw.Write([uint16]1)   # planes
    $bw.Write([uint16]32)  # bpp
    $bw.Write([uint32]$bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $bytes.Length
}
foreach ($e in $entries) {
    $bw.Write([byte[]]$e[1])
}
$bw.Flush()
$icoPath = Join-Path $resDir 'logo.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

Write-Host ("logo.ico: " + (Get-Item $icoPath).Length + " bytes")
Write-Host ("logo.png: " + (Get-Item (Join-Path $resDir 'logo.png')).Length + " bytes")
