import { spawn } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { configStore } from '../config.js'
import { resolveBinary, resolveHdc } from './binary-locator.js'
import { logger } from '../logger.js'

export function hdcBin() {
  return resolveHdc(configStore.get().general.hdcPath)
}

export function hdcRun(args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const bin = hdcBin()
    if (!bin) {
      return resolve({ code: -1, stdout: '', stderr: '未找到 hdc（鸿蒙调试工具），请在「设置 → 通用」中指定路径' })
    }
    logger.debug('[hdc]', args.join(' '))
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

export async function listHdcDevices() {
  const { code, stdout, stderr } = await hdcRun(['list', 'targets', '-v'])
  if (code !== 0) {
    logger.debug('[hdc] list targets 失败', stderr)
    return []
  }
  const items = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('[')) continue
    const parts = trimmed.split(/\s+/)
    const serial = parts[0]
    if (!serial || serial === '[Empty]') continue
    if (/^COM\d+$/i.test(serial)) continue
    const disconnected = /\b(disconnected|offline)\b/i.test(trimmed)
    items.push({
      id: serial,
      serial,
      platform: 'harmonyos',
      name: serial,
      model: '',
      state: disconnected ? 'offline' : 'device',
      connection: serial.includes(':') ? 'wifi' : 'usb',
      transportId: parts[parts.length - 1] || ''
    })
  }
  return items
}

export async function hdcShell(serial, command, opts = {}) {
  return hdcRun(['-t', serial, 'shell', command], opts)
}

export async function hdcTconn(host, port) {
  const target = `${host}:${port}`
  const res = await hdcRun(['tconn', target], { timeout: 20000 })
  const text = ((res.stdout || '') + (res.stderr || '')).trim()
  const ok = res.code === 0 && /connected successfully|connect success|already connected/i.test(text)
  return { ok, message: text || (ok ? '已连接' : '连接失败'), target }
}

export async function hdcTconnRemove(target) {
  const res = await hdcRun(['tconn', target, '-remove'], { timeout: 20000 })
  return { ok: res.code === 0, message: ((res.stdout || '') + (res.stderr || '')).trim() }
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
  wake: 224
}

export async function hdcKey(serial, key) {
  const code = KEY_CODES[key] ?? (Number.isInteger(Number(key)) ? Number(key) : null)
  if (code === null) return { ok: false, message: `未知按键: ${key}` }
  const res = await hdcShell(serial, `uinput -K -d ${code} -u ${code}`)
  return { ok: res.code === 0, message: ((res.stdout || '') + (res.stderr || '')).trim() }
}

export async function hdcScreenshot(serial, savePath) {
  mkdirSync(dirname(savePath), { recursive: true })
  const remote = `/data/local/tmp/starcast_${Date.now()}.jpg`
  const shot = await hdcShell(serial, `snapshot -f ${remote}`, { timeout: 30000 })
  if (shot.code !== 0) {
    return { ok: false, message: shot.stderr.trim() || 'hdc snapshot 失败' }
  }
  const recv = await hdcRun(['-t', serial, 'file', 'recv', remote, savePath], { timeout: 60000 })
  await hdcShell(serial, `rm -f ${remote}`)
  if (recv.code !== 0 || !existsSync(savePath)) {
    return { ok: false, message: recv.stderr.trim() || '截屏拉取失败' }
  }
  return { ok: true, path: savePath }
}

export async function hdcInstall(serial, filePath) {
  const res = await hdcRun(['-t', serial, 'install', filePath], { timeout: 300000 })
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function hdcPush(serial, localPath, remotePath) {
  const res = await hdcRun(['-t', serial, 'file', 'send', localPath, remotePath], { timeout: 600000 })
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function hdcPull(serial, remotePath, localPath) {
  mkdirSync(dirname(localPath), { recursive: true })
  const res = await hdcRun(['-t', serial, 'file', 'recv', remotePath, localPath], { timeout: 600000 })
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim(), path: localPath }
}

export async function hdcListFiles(serial, remotePath = '/data') {
  const res = await hdcShell(serial, `ls -p "${remotePath}"`, { timeout: 30000 })
  if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '目录不存在', entries: [] }
  const entries = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, isDir: name.endsWith('/') }))
  return { ok: true, entries }
}

export async function hdcReboot(serial) {
  const res = await hdcRun(['-t', serial, 'shell', 'reboot'])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export { KEY_CODES as HDC_KEY_CODES }
