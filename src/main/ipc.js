import { ipcMain, dialog, app, shell } from 'electron'
import { join } from 'path'
import { configStore } from './config.js'
import { logger } from './logger.js'
import { listAllDevices, findDevice } from './services/device-manager.js'
import * as adb from './services/adb.js'
import * as hdc from './services/hdc.js'
import * as ios from './services/ios.js'
import { checkUpdate, openDownload } from './services/updater.js'
import {
  startSession,
  stopSession,
  listSessions,
  killAllSessions,
  getSession,
  storageDir,
  scrcpyBin
} from './services/scrcpy.js'
import { startGnirehtet, stopGnirehtet, gnirehtetRunning } from './services/gnirehtet.js'
import { frameModels } from './services/frame-models.js'
import { getFramePayload, alignOverlays, startRestoreWatcher, setFrameMouseState, startWindowDrag, stopWindowDrag, updateFramePayload, markFrameRendered, setFrameTopmost } from './windows/frame-window.js'
import { getControlsPayload } from './windows/controls-window.js'
import { minimizeWindow, setWindowTopmost, sendWindowClose } from './services/win32-window.js'

function screenshotPath(deviceId, platform) {
  const ext = platform === 'harmonyos' ? 'jpg' : 'png'
  return join(storageDir('pictures'), `${platform}-${deviceId}-${Date.now()}.${ext}`)
}

async function handleScreenshot(deviceId) {
  const device = await findDevice(deviceId)
  if (!device) return { ok: false, message: '设备不在线' }
  const savePath = screenshotPath(device.id, device.platform)
  if (device.platform === 'android') return adb.adbScreenshot(device.id, savePath)
  if (device.platform === 'harmonyos') return hdc.hdcScreenshot(device.id, savePath)
  return ios.iosScreenshot(device.id, savePath)
}

async function handleShell(deviceId, command) {
  const device = await findDevice(deviceId)
  if (!device) return { ok: false, message: '设备不在线' }
  if (device.platform === 'ios') return { ok: false, message: 'iOS 不支持 shell' }
  const fn = device.platform === 'harmonyos' ? hdc.hdcShell : adb.adbShell
  const res = await fn(device.id, command, { timeout: 60000 })
  return { ok: res.code === 0, output: (res.stdout || '') + (res.stderr || ''), code: res.code }
}

async function handleControlKey(deviceId, key) {
  const device = await findDevice(deviceId)
  if (!device) return { ok: false, message: '设备不在线' }
  if (device.platform === 'ios') return ios.iosControl()
  const fn = device.platform === 'harmonyos' ? hdc.hdcKey : adb.adbKey
  return fn(device.id, key)
}

export function registerIpc() {
  // ---------- 应用 ----------
  ipcMain.handle('app:get-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    paths: {
      userData: app.getPath('userData'),
      videos: app.getPath('videos'),
      pictures: app.getPath('pictures')
    },
    versions: process.versions,
    binaries: {
      adb: adb.adbBin(),
      scrcpy: scrcpyBin(),
      hdc: hdc.hdcBin()
    }
  }))

  ipcMain.handle('app:check-update', () => checkUpdate())
  ipcMain.handle('app:open-download', (_e, url) => openDownload(url))

  ipcMain.handle('app:pick-file', async (_e, options = {}) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options.filters || [{ name: '所有文件', extensions: ['*'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('app:pick-directory', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('app:open-path', (_e, p) => shell.openPath(p))
  ipcMain.handle('app:show-item', (_e, p) => shell.showItemInFolder(p))
  ipcMain.handle('app:open-external', (_e, url) => shell.openExternal(url))

  // ---------- 配置 ----------
  ipcMain.handle('config:get', () => configStore.get())
  ipcMain.handle('config:set', (_e, patch) => configStore.set(patch))
  ipcMain.handle('config:reset', () => configStore.reset())

  // ---------- 设备 ----------
  ipcMain.handle('devices:list', () => listAllDevices())

  ipcMain.handle('devices:connect-wifi', async (_e, { host, port }) => {
    const p = Number(port) || 5555
    // 同时尝试 Android(adb) 与鸿蒙(hdc tconn)：哪条通道连通用哪个
    const [adbRes, hdcRes] = await Promise.all([
      adb.adbConnect(host, p).catch((e) => ({ ok: false, message: e.message })),
      hdc.hdcTconn(host, p).catch((e) => ({ ok: false, message: e.message }))
    ])
    if (adbRes.ok) return adbRes
    if (hdcRes.ok) return hdcRes
    return { ok: false, message: hdcRes.message || adbRes.message || '连接失败' }
  })

  ipcMain.handle('devices:disconnect', async (_e, deviceId) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    if (device.platform === 'android') return adb.adbDisconnect(device.id)
    if (device.platform === 'harmonyos') {
      if (device.id.includes(':')) return hdc.hdcTconnRemove(device.id)
      return { ok: false, message: 'USB 连接的鸿蒙设备请直接拔线' }
    }
    return { ok: false, message: '该平台不支持主动断开' }
  })

  // ---------- 设备能力 ----------
  ipcMain.handle('device:screenshot', (_e, deviceId) => handleScreenshot(deviceId))

  ipcMain.handle('device:install', async (_e, { deviceId, filePath }) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    if (device.platform === 'ios') return { ok: false, message: 'iOS 暂不支持安装应用' }
    const fn = device.platform === 'harmonyos' ? hdc.hdcInstall : adb.adbInstall
    return fn(device.id, filePath)
  })

  ipcMain.handle('device:list-packages', async (_e, deviceId) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线', packages: [] }
    if (device.platform !== 'android') return { ok: false, message: '该平台暂不支持应用列表', packages: [] }
    return adb.adbListPackages(device.id)
  })

  ipcMain.handle('device:app-labels', async (_e, { deviceId, packages }) => {
    logger.info('[app-labels] 请求', deviceId, 'count', Array.isArray(packages) ? packages.length : 'n/a')
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android' || !Array.isArray(packages)) {
      logger.warn('[app-labels] 提前返回', !!device, device && device.platform)
      return { ok: false, labels: {} }
    }
    const labels = {}
    const queue = [...packages]
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const pkg = queue.shift()
        if (!pkg) continue
        try {
          const r = await adb.adbAppLabel(device.id, pkg)
          labels[pkg] = r.label || pkg
        } catch {
          labels[pkg] = pkg
        }
      }
    })
    await Promise.all(workers)
    return { ok: true, labels }
  })

  ipcMain.handle('device:uninstall', async (_e, { deviceId, packageName }) => {
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android') return { ok: false, message: '该平台暂不支持卸载' }
    return adb.adbUninstall(device.id, packageName)
  })

  ipcMain.handle('device:launch-package', async (_e, { deviceId, packageName }) => {
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android') return { ok: false, message: '该平台暂不支持启动应用' }
    return adb.adbLaunchPackage(device.id, packageName)
  })

  ipcMain.handle('device:list-files', async (_e, { deviceId, path }) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线', entries: [] }
    if (device.platform === 'ios') return { ok: false, message: 'iOS 暂不支持文件管理', entries: [] }
    const fn = device.platform === 'harmonyos' ? hdc.hdcListFiles : adb.adbListFiles
    return fn(device.id, path || (device.platform === 'harmonyos' ? '/data' : '/sdcard'))
  })

  ipcMain.handle('device:push', async (_e, { deviceId, localPath, remotePath }) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    if (device.platform === 'ios') return { ok: false, message: 'iOS 暂不支持文件推送' }
    const fn = device.platform === 'harmonyos' ? hdc.hdcPush : adb.adbPush
    return fn(device.id, localPath, remotePath)
  })

  ipcMain.handle('device:pull', async (_e, { deviceId, remotePath }) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    if (device.platform === 'ios') return { ok: false, message: 'iOS 暂不支持文件拉取' }
    const localPath = join(storageDir('videos'), `文件-${Date.now()}-${remotePath.split('/').pop()}`)
    const fn = device.platform === 'harmonyos' ? hdc.hdcPull : adb.adbPull
    return fn(device.id, remotePath, localPath)
  })

  ipcMain.handle('device:pull-batch', async (_e, { deviceId, remotePaths, targetDir }) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    if (device.platform === 'ios') return { ok: false, message: 'iOS 暂不支持文件拉取' }
    const dir = targetDir || storageDir('videos')
    const fn = device.platform === 'harmonyos' ? hdc.hdcPull : adb.adbPull
    const results = []
    for (const remotePath of remotePaths || []) {
      const name = remotePath.split('/').filter(Boolean).pop() || 'file'
      const localPath = join(dir, name)
      const r = await fn(device.id, remotePath, localPath)
      results.push({ name, ok: r.ok, path: localPath, message: r.message })
    }
    const okCount = results.filter((r) => r.ok).length
    return { ok: okCount > 0, results, message: `已下载 ${okCount}/${results.length} 个文件到 ${dir}` }
  })

  ipcMain.handle('device:thumbnail', async (_e, { deviceId, remotePath }) => {
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android') return { ok: false }
    return adb.adbThumbnail(device.id, remotePath)
  })

  ipcMain.handle('device:shell', (_e, { deviceId, command }) => handleShell(deviceId, command))

  // ---------- 设备控制 ----------
  ipcMain.handle('control:key', (_e, { deviceId, key }) => handleControlKey(deviceId, key))

  ipcMain.handle('control:rotate', async (_e, { deviceId, orientation }) => {
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android') return { ok: false, message: '该平台暂不支持旋转控制' }
    return adb.adbRotate(device.id, orientation)
  })

  ipcMain.handle('control:notifications', async (_e, { deviceId, expand }) => {
    const device = await findDevice(deviceId)
    if (!device || device.platform !== 'android') return { ok: false, message: '该平台暂不支持通知栏控制' }
    return adb.adbNotifications(device.id, expand)
  })

  ipcMain.handle('control:reboot', async (_e, deviceId) => {
    const device = await findDevice(deviceId)
    if (!device) return { ok: false, message: '设备不在线' }
    const fn = device.platform === 'harmonyos' ? hdc.hdcReboot : adb.adbReboot
    return fn(device.id)
  })

  ipcMain.handle('control:gnirehtet-start', (_e, deviceId) => startGnirehtet(deviceId))
  ipcMain.handle('control:gnirehtet-stop', () => stopGnirehtet())
  ipcMain.handle('control:gnirehtet-status', () => ({ running: gnirehtetRunning() }))

  // ---------- 投屏会话 ----------
  ipcMain.handle('scrcpy:start', (_e, payload) => startSession(payload))
  ipcMain.handle('scrcpy:stop', (_e, sessionId) => stopSession(sessionId))
  ipcMain.handle('scrcpy:stop-all', () => {
    killAllSessions()
    return { ok: true }
  })
  ipcMain.handle('scrcpy:list', () => listSessions())

  // ---------- 一体投屏：触控与按键（鸿蒙 sidecar / Android scrcpy 裸流） ----------
  ipcMain.handle('hos:input', (event, ev) => {
    const payload = getFramePayload(event.sender.id)
    if (!payload) return { ok: false }
    const session = getSession(payload.sessionId)
    if (!session) return { ok: false }
    // Android scrcpy 裸流：input() 内部按 dims 把归一化坐标转物理，直接透传
    if (session.stream) {
      session.stream.input(ev)
      return { ok: true }
    }
    if (!session.hos) return { ok: false }
    // 鸿蒙 sidecar 需要物理像素：渲染层归一化坐标(0~1) × 设备尺寸
    const dims = payload.deviceSize || { width: 1080, height: 2406 }
    let phys = ev
    if (ev.type === 'tap') {
      phys = { ...ev, x: Math.round(ev.x * dims.width), y: Math.round(ev.y * dims.height) }
    } else if (ev.type === 'swipe') {
      phys = {
        ...ev,
        x1: Math.round(ev.x1 * dims.width), y1: Math.round(ev.y1 * dims.height),
        x2: Math.round(ev.x2 * dims.width), y2: Math.round(ev.y2 * dims.height)
      }
    }
    session.hos.input(phys)
    return { ok: true }
  })

  ipcMain.handle('hos:key', (event, name) => {
    const payload = getFramePayload(event.sender.id)
    if (!payload) return { ok: false }
    const session = getSession(payload.sessionId)
    if (!session) return { ok: false }
    if (session.stream) { session.stream.key(name); return { ok: true } }
    if (!session.hos) return { ok: false }
    session.hos.key(name)
    return { ok: true }
  })

  // ---------- 镜像窗口控制（置顶/最小化/关闭） ----------
  ipcMain.handle('window:control', (_e, { sessionId, action }) => {
    const session = getSession(sessionId)
    if (!session) return { ok: false, message: '会话不存在' }
    const title = session.windowTitle

    // 一体模式（鸿蒙/Android scrcpy）：frame 窗口就是画面本身，直接操作该窗口
    if (session.hos || session.stream) {
      const fw = session.hosWin || session.streamWin
      if (action === 'minimize') {
        if (fw && !fw.isDestroyed()) fw.minimize()
        return { ok: true }
      }
      if (action === 'topmost') {
        const next = !session.topmost
        if (fw && !fw.isDestroyed()) fw.setAlwaysOnTop(next)
        session.topmost = next
        updateFramePayload(sessionId, { topmost: next })
        return { ok: true, topmost: next }
      }
      if (action === 'close') {
        stopSession(sessionId)
        return { ok: true }
      }
    }
    if (action === 'minimize') {
      const res = minimizeWindow(title)
      alignOverlays(sessionId)
      startRestoreWatcher(sessionId)
      return res
    }
    if (action === 'topmost') {
      const next = !session.topmost
      const res = setWindowTopmost(title, next)
      if (res.ok) {
        session.topmost = next
        setFrameTopmost(sessionId, next)
        updateFramePayload(sessionId, { topmost: next })
      }
      return { ok: res.ok, topmost: next }
    }
    if (action === 'close') {
      const res = sendWindowClose(title)
      // 兜底：窗口未响应 WM_CLOSE 则强制结束会话
      setTimeout(() => {
        if (getSession(sessionId)) stopSession(sessionId)
      }, 1500)
      return res
    }
    return { ok: false, message: `未知操作: ${action}` }
  })

  // ---------- 外壳窗口（拉取式 payload） ----------
  ipcMain.handle('frame:get-payload', (event) => getFramePayload(event.sender.id))
  ipcMain.handle('frame:rendered', (event) => {
    markFrameRendered(event.sender.id)
    return { ok: true }
  })
  ipcMain.handle('frame:invalidate', (event) => {
    try { event.sender.invalidate() } catch {}
    return { ok: true }
  })
  ipcMain.handle('controls:get-payload', (event) => getControlsPayload(event.sender.id))

  // ---------- 边框拖动 / 点击穿透 ----------
  ipcMain.handle('frame:mouse-state', (event, { ring }) => {
    setFrameMouseState(event.sender.id, !!ring)
    return { ok: true }
  })
  ipcMain.handle('frame:drag-start', (event) => {
    const payload = getFramePayload(event.sender.id)
    return payload ? startWindowDrag(payload.sessionId) : { ok: false, message: '会话不存在' }
  })
  ipcMain.handle('frame:drag-end', (event) => {
    const payload = getFramePayload(event.sender.id)
    if (payload) stopWindowDrag(payload.sessionId)
    return { ok: true }
  })

  // ---------- 机型边框模型 ----------
  ipcMain.handle('frame:models', () => Object.values(frameModels))

  logger.info('[ipc] IPC 注册完成')
}
