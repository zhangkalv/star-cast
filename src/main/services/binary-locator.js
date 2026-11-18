import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { configStore } from '../config.js'
import { resourcePath } from './paths.js'
import { logger } from '../logger.js'

const BIN_NAMES = {
  adb: { win32: 'adb.exe', others: 'adb' },
  aapt: { win32: 'aapt.exe', others: 'aapt' },
  scrcpy: { win32: 'scrcpy.exe', others: 'scrcpy' },
  gnirehtet: { win32: 'gnirehtet.exe', others: 'gnirehtet' },
  hdc: { win32: 'hdc.exe', others: 'hdc' },
  idevice_id: { win32: 'idevice_id.exe', others: 'idevice_id' },
  ideviceinfo: { win32: 'ideviceinfo.exe', others: 'ideviceinfo' },
  idevicescreenshot: { win32: 'idevicescreenshot.exe', others: 'idevicescreenshot' }
}

/**
 * 解析外部二进制路径：自定义路径 > 内置目录（resources/bin/<platform>）> 系统 PATH
 * @returns {string|null}
 */
export function resolveBinary(key, customPath) {
  const fileName = (BIN_NAMES[key] && BIN_NAMES[key][process.platform]) || BIN_NAMES[key]?.others || key

  if (customPath && existsSync(customPath)) return customPath

  const vendor = resourcePath('bin', process.platform, fileName)
  if (existsSync(vendor)) return vendor

  try {
    const out =
      process.platform === 'win32'
        ? execFileSync('where', [fileName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).find(Boolean)
        : execFileSync('which', [fileName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (out && existsSync(out)) return out
  } catch {
    /* PATH 中不存在 */
  }
  return null
}

/** 内置工具目录 */
export function bundledBinDir() {
  return resourcePath('bin', process.platform)
}

/**
 * 子进程环境：把内置工具目录注入 PATH（scrcpy/gnirehtet 依赖 adb 在 PATH 中），
 * 并通过 SCRCPY_ADB_PATH 显式告知 scrcpy 的 adb 位置。
 */
export function toolsEnv(extra = {}) {
  const adbPath = resolveBinary('adb', configStore.get().general.adbPath)
  const dirs = [adbPath ? dirname(adbPath) : '', bundledBinDir()].filter(Boolean)
  const env = {
    ...process.env,
    ...extra,
    PATH: [...dirs, process.env.PATH].join(';')
  }
  if (adbPath) {
    env.SCRCPY_ADB_PATH = adbPath
    // scrcpy 会优先读取 ADB 环境变量，必须一并覆盖，
    // 否则系统残留的旧 ADB 路径会导致 CreateProcessW error 2
    env.ADB = adbPath
  }
  logger.debug('[binary] toolsEnv PATH 前缀', dirs.join(';'))
  return env
}
