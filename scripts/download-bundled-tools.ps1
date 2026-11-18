# Download and bundle third-party binaries into resources/bin/win32
# Usage:
#   .\scripts\download-bundled-tools.ps1              # all
#   .\scripts\download-bundled-tools.ps1 -Only adb    # adb | scrcpy | gnirehtet | hdc | ios
param(
    [ValidateSet('', 'adb', 'scrcpy', 'gnirehtet', 'hdc', 'ios')]
    [string]$Only = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'resources\bin\win32'
$tmp = Join-Path $env:TEMP 'starcast-tools'
New-Item -ItemType Directory -Force -Path $dest, $tmp | Out-Null

function Get-File {
    param([string[]]$Urls, [string]$OutFile)
    foreach ($u in $Urls) {
        Write-Host "  -> $u"
        try {
            $prev = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $u -OutFile $OutFile -TimeoutSec 300 -UseBasicParsing
            $ProgressPreference = $prev
            if ((Test-Path $OutFile) -and (Get-Item $OutFile).Length -gt 100KB) {
                Write-Host ("  OK (" + [math]::Round((Get-Item $OutFile).Length / 1MB, 2) + " MB)")
                return $true
            }
        } catch {
            Write-Warning ("  download failed: " + $_.Exception.Message)
        }
    }
    return $false
}

function Copy-Flat {
    param([string]$FromDir, [string]$ToDir)
    Get-ChildItem -Path $FromDir -Recurse -File | ForEach-Object {
        Copy-Item $_.FullName -Destination (Join-Path $ToDir $_.Name) -Force
    }
}

# ---------------- adb (Android platform-tools) ----------------
if ($Only -in @('', 'adb')) {
    Write-Host '[adb] downloading Android platform-tools ...'
    $zip = Join-Path $tmp 'platform-tools.zip'
    $ok = Get-File -Urls @(
        'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
        'https://registry.npmmirror.com/-/binary/platform-tools/platform-tools-latest-windows.zip',
        'https://mirrors.cloud.tencent.com/AndroidSDK/platform-tools-latest-windows.zip'
    ) -OutFile $zip
    if ($ok) {
        $ext = Join-Path $tmp 'platform-tools'
        Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $ext -Force
        Copy-Flat -FromDir (Join-Path $ext 'platform-tools') -ToDir $dest
        Write-Host '[adb] bundled into resources\bin\win32'
    } else {
        Write-Warning '[adb] all mirrors failed'
    }
}

# ---------------- scrcpy ----------------
if ($Only -in @('', 'scrcpy')) {
    Write-Host '[scrcpy] downloading scrcpy-win64 v5.0.1 ...'
    $zip = Join-Path $tmp 'scrcpy-win64.zip'
    $ok = Get-File -Urls @(
        'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip',
        'https://mirror.ghproxy.com/https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip',
        'https://ghfast.top/https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip'
    ) -OutFile $zip
    if ($ok) {
        $ext = Join-Path $tmp 'scrcpy'
        Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $ext -Force
        $inner = Get-ChildItem $ext -Directory | Select-Object -First 1
        Copy-Flat -FromDir $inner.FullName -ToDir $dest
        Write-Host '[scrcpy] bundled into resources\bin\win32'
    } else {
        Write-Warning '[scrcpy] all mirrors failed'
    }
}

# ---------------- gnirehtet (reverse tethering) ----------------
if ($Only -in @('', 'gnirehtet')) {
    Write-Host '[gnirehtet] downloading gnirehtet win64 ...'
    $zip = Join-Path $tmp 'gnirehtet.zip'
    $ok = Get-File -Urls @(
        'https://github.com/Genymobile/gnirehtet/releases/download/rust-2.5.1/gnirehtet-rust-2.5.1-win64.zip',
        'https://mirror.ghproxy.com/https://github.com/Genymobile/gnirehtet/releases/download/rust-2.5.1/gnirehtet-rust-2.5.1-win64.zip',
        'https://ghfast.top/https://github.com/Genymobile/gnirehtet/releases/download/rust-2.5.1/gnirehtet-rust-2.5.1-win64.zip'
    ) -OutFile $zip
    if ($ok) {
        $ext = Join-Path $tmp 'gnirehtet'
        Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $ext -Force
        $inner = Get-ChildItem $ext -Directory | Select-Object -First 1
        Copy-Flat -FromDir $inner.FullName -ToDir $dest
        Write-Host '[gnirehtet] bundled into resources\bin\win32'
    } else {
        Write-Warning '[gnirehtet] all mirrors failed'
    }
}

# ---------------- hdc (HarmonyOS) ----------------
if ($Only -in @('', 'hdc')) {
    Write-Host '[hdc] downloading hdc (HarmonyOS device connector) ...'
    $zip = Join-Path $tmp 'hdc.zip'
    $ok = Get-File -Urls @(
        'https://git.ustc.edu.cn/KONC/oh_lab/-/raw/main/HDC.zip',
        'https://repo.huaweicloud.com/harmonyos/os/3.2-Release/ohos-sdk-windows_linux-public.tar.gz'
    ) -OutFile $zip
    if ($ok) {
        $ext = Join-Path $tmp 'hdc'
        Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue
        try {
            Expand-Archive -Path $zip -DestinationPath $ext -Force
        } catch {
            Write-Warning ('[hdc] not a zip archive, skip extract: ' + $_.Exception.Message)
            $ok = $false
        }
    }
    if ($ok) {
        $hdcExe = Get-ChildItem $ext -Recurse -File -Filter 'hdc.exe' | Select-Object -First 1
        if ($hdcExe) {
            Copy-Item $hdcExe.FullName -Destination (Join-Path $dest 'hdc.exe') -Force
            $dll = Get-ChildItem $hdcExe.DirectoryName -File -Filter '*.dll' -ErrorAction SilentlyContinue
            foreach ($d in $dll) { Copy-Item $d.FullName -Destination (Join-Path $dest $d.Name) -Force }
            Write-Host '[hdc] hdc.exe bundled'
        } else {
            Write-Warning '[hdc] hdc.exe not found in archive'
        }
    } else {
        Write-Warning '[hdc] all mirrors failed (place hdc.exe manually for HarmonyOS NEXT devices)'
    }
}

# ---------------- iOS (libimobiledevice) ----------------
if ($Only -in @('', 'ios')) {
    Write-Host '[ios] downloading libimobiledevice win64 ...'
    $zip = Join-Path $tmp 'libimobiledevice.zip'
    $ok = Get-File -Urls @(
        'https://github.com/mass1ve-err0r/libimobiledevice-win32/archive/refs/heads/master.zip',
        'https://github.com/mass1ve-err0r/libimobiledevice-win32/archive/refs/heads/main.zip',
        'https://mirror.ghproxy.com/https://github.com/mass1ve-err0r/libimobiledevice-win32/archive/refs/heads/master.zip'
    ) -OutFile $zip
    if ($ok) {
        $ext = Join-Path $tmp 'ios'
        Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $ext -Force
        $idevice = Get-ChildItem $ext -Recurse -File -Filter 'idevice_id.exe' | Select-Object -First 1
        if ($idevice) {
            Copy-Flat -FromDir $idevice.DirectoryName -ToDir $dest
            Write-Host '[ios] idevice tools bundled'
        } else {
            Write-Warning '[ios] idevice_id.exe not found in archive'
        }
    } else {
        Write-Warning '[ios] all mirrors failed (place idevice_id.exe manually)'
    }
}

Write-Host ''
Write-Host '===== bundled result ====='
Get-ChildItem $dest -File | ForEach-Object {
    Write-Host ("  " + $_.Name + "  " + [math]::Round($_.Length / 1MB, 2) + " MB")
}
