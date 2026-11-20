import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
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

let cachedHdc = { key: null, path: null }

function hdcVersion(file) {
  try {
    const out = execFileSync(file, ['-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
    const m = /Ver:\s*(\d+)\.(\d+)\.(\d+)([a-z])?/i.exec(out)
    if (!m) return [0, 0, 0, '']
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), (m[4] || '').toLowerCase()]
  } catch {
    return [-1, 0, 0, '']
  }
}

function compareHdcVersion(a, b) {
  for (let i = 0; i < 4; i++) {
    const av = a[i], bv = b[i]
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return String(av).localeCompare(String(bv))
  }
  return 0
}

export function resolveHdc(customPath) {
  const candidates = []
  if (customPath && existsSync(customPath)) return customPath
  if (cachedHdc.key === (customPath || '') && cachedHdc.path && existsSync(cachedHdc.path)) return cachedHdc.path

  candidates.push(resourcePath('bin', process.platform, BIN_NAMES.hdc[process.platform] || BIN_NAMES.hdc.others))
  if (process.platform === 'win32') {
    const roots = ['C:\\Program Files', 'C:\\Program Files (x86)', 'D:\\Program Files']
    for (const root of roots) {
      const devEco = join(root, 'Huawei', 'DevEco Studio')
      if (!existsSync(devEco)) continue
      try {
        for (const sdk of readdirSync(devEco)) {
          const p = join(devEco, sdk, 'openharmony', 'toolchains', 'hdc.exe')
          if (existsSync(p)) candidates.push(p)
        }
      } catch {}
    }
  }
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['hdc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    for (const line of out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      if (existsSync(line)) candidates.push(line)
    }
  } catch {}

  let best = null
  let bestVer = null
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const v = hdcVersion(p)
    if (!best || compareHdcVersion(v, bestVer) > 0) {
      best = p
      bestVer = v
    }
  }
  cachedHdc = { key: customPath || '', path: best }
  return best
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
