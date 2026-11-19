# 一键：关闭应用 -> 写入配置 -> 重启
# 背景：渲染进程 Pinia 旧内存状态会在下次 save() 时覆盖 config.json，
#       所以手工改配置必须先彻底关闭应用再写文件。
param(
    [string]$ConfigJson,
    [string]$ConfigFile,
    [switch]$Start = $true
)

$ErrorActionPreference = 'Stop'

# 1. 关闭正在运行的星点投屏（含 Electron 开发进程）
Get-Process -Name 'electron','star-record','星点投屏' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

# 2. 写入配置
$configPath = Join-Path $env:APPDATA 'star-record\config.json'
$configDir = Split-Path $configPath -Parent
if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir | Out-Null }

if ($ConfigFile) {
    Copy-Item -Path $ConfigFile -Destination $configPath -Force
    Write-Host "已从 $ConfigFile 写入配置 -> $configPath"
} elseif ($ConfigJson) {
    Set-Content -Path $configPath -Value $ConfigJson -Encoding UTF8
    Write-Host "已写入配置 -> $configPath"
} else {
    Write-Host "未提供配置内容，仅执行重启。用法示例："
    Write-Host "  .\scripts\restart-with-config.ps1 -ConfigJson '{`"frame`":{`"enabled`":true}}'"
}

# 3. 重启应用
if ($Start) {
    $bat = Join-Path (Split-Path $PSScriptRoot -Parent) '启动星点投屏.bat'
    Start-Process $bat -WindowStyle Minimized
    Write-Host '已重新启动星点投屏'
}
