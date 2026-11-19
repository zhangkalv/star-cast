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
  hdc: { win32: 'hdc.exe', others: 'hdc' }
}

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
  }
  return null
}

export function bundledBinDir() {
  return resourcePath('bin', process.platform)
}

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
    env.ADB = adbPath
  }
  logger.debug('[binary] toolsEnv PATH 前缀', dirs.join(';'))
  return env
}
