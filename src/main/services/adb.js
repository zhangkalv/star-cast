import { spawn } from 'child_process'
import { createWriteStream, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { configStore } from '../config.js'
import { resolveBinary } from './binary-locator.js'
import { logger } from '../logger.js'

export function adbBin() {
  return resolveBinary('adb', configStore.get().general.adbPath)
}

export function adbRun(args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const bin = adbBin()
    if (!bin) {
      return resolve({ code: -1, stdout: '', stderr: '未找到 adb，请在「设置 → 通用」中指定路径' })
    }
    logger.debug('[adb]', args.join(' '))
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: err.message })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** 解析 `adb devices -l` 输出为统一设备结构 */
export async function listAdbDevices() {
  const { code, stdout, stderr } = await adbRun(['devices', '-l'])
  if (code !== 0) {
    logger.warn('[adb] devices 失败', stderr)
    return []
  }
  const items = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('List of') || trimmed.startsWith('*')) continue
    const parts = trimmed.split(/\s+/)
    const serial = parts[0]
    const state = parts[1] || 'unknown'
    const meta = {}
    for (const part of parts.slice(2)) {
      const idx = part.indexOf(':')
      if (idx > 0) meta[part.slice(0, idx)] = part.slice(idx + 1)
    }
    items.push({
      id: serial,
      serial,
      platform: 'android',
      name: meta.model || serial,
      model: meta.model || '',
      state,
      connection: serial.includes(':') ? 'wifi' : 'usb',
      transportId: meta.transport_id || ''
    })
  }
  return items
}

export async function adbShell(serial, command, opts = {}) {
  return adbRun(['-s', serial, 'shell', command], opts)
}

/** 设备屏幕分辨率（wm size），用于按比例计算镜像窗口尺寸 */
export async function adbScreenSize(serial) {
  const res = await adbShell(serial, 'wm size')
  if (res.code !== 0) return null
  const m = /Override size:\s*(\d+)x(\d+)/.exec(res.stdout) || /Physical size:\s*(\d+)x(\d+)/.exec(res.stdout)
  if (!m) return null
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
}

const KEY_CODES = {
  back: 4,
  home: 3,
  recents: 187,
  power: 26,
  volumeUp: 24,
  volumeDown: 25,
  menu: 82,
  sleep: 222,
  wake: 224,
  camera: 27,
  search: 84,
  mute: 164,
  brightnessUp: 221,
  brightnessDown: 220,
  enter: 66,
  del: 67
}

export async function adbKey(serial, key) {
  const code = KEY_CODES[key] ?? (Number.isInteger(Number(key)) ? Number(key) : null)
  if (code === null) return { ok: false, message: `未知按键: ${key}` }
  const res = await adbShell(serial, `input keyevent ${code}`)
  return { ok: res.code === 0, message: res.stderr.trim() }
}

export async function adbRotate(serial, orientation) {
  // orientation: 'auto' | '0' | '1' | '2' | '3'
  if (orientation === 'auto') {
    await adbShell(serial, 'settings put system accelerometer_rotation 1')
    return { ok: true }
  }
  await adbShell(serial, 'settings put system accelerometer_rotation 0')
  const res = await adbShell(serial, `settings put system user_rotation ${orientation}`)
  return { ok: res.code === 0, message: res.stderr.trim() }
}

export async function adbNotifications(serial, expand) {
  const cmd = expand ? 'cmd statusbar expand-notifications' : 'cmd statusbar collapse'
  const res = await adbShell(serial, cmd)
  return { ok: res.code === 0, message: res.stderr.trim() }
}

export async function adbScreenshot(serial, savePath) {
  mkdirSync(dirname(savePath), { recursive: true })
  return new Promise((resolve) => {
    const bin = adbBin()
    if (!bin) return resolve({ ok: false, message: '未找到 adb' })
    logger.debug('[adb] screencap ->', savePath)
    const child = spawn(bin, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true })
    const stream = createWriteStream(savePath)
    child.stdout.pipe(stream)
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => resolve({ ok: false, message: err.message }))
    stream.on('finish', () => resolve({ ok: true, path: savePath }))
    child.on('close', (code) => {
      if (code !== 0) resolve({ ok: false, message: stderr.trim() || `screencap 退出码 ${code}` })
    })
  })
}

export async function adbInstall(serial, filePath) {
  const res = await adbRun(['-s', serial, 'install', '-r', filePath], { timeout: 300000 })
  const ok = res.code === 0 && /Success/i.test(res.stdout + res.stderr)
  return { ok, message: (res.stdout + res.stderr).trim() }
}

export async function adbUninstall(serial, packageName) {
  const res = await adbRun(['-s', serial, 'uninstall', packageName])
  return { ok: res.code === 0 && /Success/i.test(res.stdout), message: (res.stdout + res.stderr).trim() }
}

export async function adbPush(serial, localPath, remotePath) {
  const res = await adbRun(['-s', serial, 'push', localPath, remotePath], { timeout: 600000 })
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function adbPull(serial, remotePath, localPath) {
  mkdirSync(dirname(localPath), { recursive: true })
  const res = await adbRun(['-s', serial, 'pull', remotePath, localPath], { timeout: 600000 })
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim(), path: localPath }
}

/** 读取设备图片的缩略图（pull 到缓存目录并转 data URL），失败返回 null */
export async function adbThumbnail(serial, remotePath) {
  const cacheDir = join(app.getPath('userData'), 'thumb-cache')
  try { mkdirSync(cacheDir, { recursive: true }) } catch {}
  const name = remotePath.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_')
  const version = (await adbShell(serial, `stat -c %Y "${remotePath}" 2>/dev/null || echo 0`, { timeout: 10000 })).stdout.trim()
  const cacheFile = join(cacheDir, `${name}_${version}.img`)
  try {
    if (existsSync(cacheFile)) {
      const buf = readFileSync(cacheFile)
      return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` }
    }
  } catch {}
  const res = await adbPull(serial, remotePath, cacheFile)
  if (!res.ok) return { ok: false }
  try {
    const buf = readFileSync(cacheFile)
    const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  } catch {
    return { ok: false }
  }
}

export async function adbListFiles(serial, remotePath = '/sdcard') {
  const res = await adbShell(serial, `ls -p "${remotePath}"`, { timeout: 30000 })
  if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '目录不存在', entries: [] }
  const entries = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, isDir: name.endsWith('/') }))
  return { ok: true, entries }
}

export async function adbListPackages(serial) {
  const res = await adbShell(serial, 'pm list packages -3', { timeout: 30000 })
  if (res.code !== 0) return { ok: false, message: res.stderr.trim(), packages: [] }
  const packages = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length))
  return { ok: true, packages }
}

/**
 * 读取单个应用名称：pm path 取 APK 路径 -> pull 到缓存目录 -> aapt dump badging 解析 label。
 * 结果缓存到磁盘（key=包名+版本），下次命中直接返回，避免重复 pull 大文件。
 */
export async function adbAppLabel(serial, packageName) {
  const cacheDir = join(app.getPath('userData'), 'apk-cache')
  try { mkdirSync(cacheDir, { recursive: true }) } catch {}

  const version = (await adbShell(serial, `dumpsys package ${packageName} | grep -m1 versionName`, { timeout: 15000 })).stdout.trim()
  const safe = packageName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const cacheFile = join(cacheDir, `${safe}.json`)
  try {
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (cached && cached.label) return { ok: true, label: cached.label, packageName }
    }
  } catch {}

  const pathRes = await adbShell(serial, `pm path ${packageName}`, { timeout: 15000 })
  const apkPath = (pathRes.stdout || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('package:'))
  if (!apkPath) return { ok: false, label: packageName, packageName }

  const tmpApk = join(tmpdir(), `star_apk_${safe}_${Date.now()}.apk`)
  const aapt = resolveBinary('aapt', null)
  let label = packageName
  try {
    const pull = await adbRun(['-s', serial, 'pull', apkPath.slice('package:'.length), tmpApk], { timeout: 120000 })
    if (pull.code === 0 && aapt) {
      const out = await new Promise((resolve) => {
        const cp = spawn(aapt, ['dump', 'badging', tmpApk], { windowsHide: true })
        const chunks = []
        cp.stdout.on('data', (d) => chunks.push(Buffer.from(d)))
        cp.on('error', () => resolve(''))
        cp.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      const zh = /application-label-zh-CN:'([\s\S]*?)'/.exec(out)
      const m = /application-label:'([\s\S]*?)'/.exec(out)
      if (m) label = zh ? zh[1] : m[1]
    }
  } catch (e) {
    logger.warn('[adb] 应用名解析失败', packageName, e.message)
  } finally {
    try { if (existsSync(tmpApk)) unlinkSync(tmpApk) } catch {}
  }

  try { writeFileSync(cacheFile, JSON.stringify({ label, version }), 'utf8') } catch {}
  return { ok: true, label, packageName }
}

export async function adbLaunchPackage(serial, packageName) {
  const res = await adbShell(serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`)
  return { ok: res.code === 0, message: res.stderr.trim() }
}

export async function adbConnect(host, port = 5555) {
  const address = `${host}:${port}`
  const res = await adbRun(['connect', address], { timeout: 10000 })
  const ok = /connected/i.test(res.stdout + res.stderr)
  return { ok, message: (res.stdout + res.stderr).trim(), address }
}

export async function adbDisconnect(serial) {
  const res = await adbRun(['disconnect', serial])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function adbReboot(serial) {
  const res = await adbRun(['-s', serial, 'reboot'])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export { KEY_CODES }
