import { spawn } from 'child_process'
import { join } from 'path'
import { app, screen } from 'electron'
import { configStore } from '../config.js'
import { resolveBinary, toolsEnv } from './binary-locator.js'
import { logger } from '../logger.js'
import { getFrameModel } from './frame-models.js'
import { openFrameWindow, closeFrameWindow, alignOverlays, waitForFrameReady, showFrameWindow, updateFramePayload } from '../windows/frame-window.js'
import { queryWindow, moveWindow, hideWindow, showWindow, setWindowCorners } from './win32-window.js'
import { openControlsWindow, closeControlsWindow } from '../windows/controls-window.js'
import { getMainWindow } from '../windows/main-window.js'
import { adbScreenSize } from './adb.js'
import { startHosSidecar } from './hos-sidecar.js'
import { startScrcpyStream } from './scrcpy-stream.js'

const sessions = new Map()
let seq = 0

export function scrcpyBin() {
  return resolveBinary('scrcpy', configStore.get().general.scrcpyPath)
}

export function storageDir(kind = 'videos') {
  const custom = configStore.get().general.storagePath
  if (custom) return custom
  const base = kind === 'pictures' ? app.getPath('pictures') : app.getPath('videos')
  return join(base, '星点投屏')
}

function tokenize(str) {
  return String(str || '')
    .match(/"[^"]*"|'[^']*'|\S+/g)
    ?.map((t) => t.replace(/^["']|["']$/g, '')) || []
}

async function getDeviceScreenSize(platform, deviceId, mode, s) {
  if (mode === 'camera') {
    const m = /^(\d+)\s*x\s*(\d+)$/.exec((s.camera.size || '').trim())
    if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
    return { width: 16, height: 9 }
  }
  try {
    const size = platform === 'android' ? await adbScreenSize(deviceId) : null
    if (size && size.width > 0 && size.height > 0) return size
  } catch (e) {
    logger.debug('[scrcpy] 获取屏幕分辨率失败', e.message)
  }
  return null
}

function resolveWindowRect(windowSettings, ratio, fillScreen = false) {
  const area = screen.getPrimaryDisplay().workArea
  let height = fillScreen
    ? Math.round(area.height * 0.94)
    : (windowSettings.height > 0 ? windowSettings.height : Math.round(area.height * 0.9))
  let width
  if (ratio && ratio.width > 0 && ratio.height > 0) {
    width = Math.round((height * ratio.width) / ratio.height)
    const maxWidth = area.width - 80
    if (width > maxWidth) {
      width = maxWidth
      height = Math.round((width * ratio.height) / ratio.width)
    }
  } else {
    width = windowSettings.width > 0 ? windowSettings.width : Math.round(area.height * 0.42)
  }
  const x = windowSettings.x >= 0 ? windowSettings.x : area.x + Math.round((area.width - width) / 2)
  const y = windowSettings.y >= 0 ? windowSettings.y : area.y + Math.round((area.height - height) / 2)
  return { x, y, width, height }
}

export function buildArgs({ serial, mode, overrides = {}, rect, recordPath }) {
  const s = configStore.get()
  const args = ['-s', serial, '--window-title', overrides.windowTitle || `星点投屏 · ${serial}`]

  if (mode === 'otg') {
    args.push('--otg')
    args.push(...tokenize(s.general.scrcpyExtraArgs), ...tokenize(overrides.rawArgs))
    return args
  }

  if (mode === 'flexible') {
    args.push(...tokenize(overrides.rawArgs || s.general.scrcpyExtraArgs))
    return args
  }

  if (!s.video.enabled) {
    args.push('--no-video')
  } else {
    if (Number(s.video.maxSize) > 0) args.push(`--max-size=${s.video.maxSize}`)
    if (s.video.bitRate) args.push(`--video-bit-rate=${s.video.bitRate}`)
    if (Number(s.video.fps) > 0) args.push(`--max-fps=${s.video.fps}`)
    if (s.video.codec) args.push(`--video-codec=${s.video.codec}`)
    if (s.video.orientation && s.video.orientation !== '0') args.push(`--orientation=${s.video.orientation}`)
    if (s.video.crop) args.push(`--crop=${s.video.crop}`)
    if (s.video.displayId !== '' && s.video.displayId != null) args.push(`--display-id=${s.video.displayId}`)
    if (Number(s.video.bufferMs) > 0) args.push(`--video-buffer=${s.video.bufferMs}`)
    if (Number(s.video.v4l2BufferMs) > 0) args.push(`--v4l2-buffer=${s.video.v4l2BufferMs}`)
  }

  if (!s.audio.enabled || mode === 'record') {
    args.push('--no-audio')
  } else {
    if (s.audio.source) args.push(`--audio-source=${s.audio.source}`)
    if (s.audio.codec) args.push(`--audio-codec=${s.audio.codec}`)
    if (s.audio.bitRate) args.push(`--audio-bit-rate=${s.audio.bitRate}`)
    if (Number(s.audio.bufferMs) > 0) args.push(`--audio-buffer=${s.audio.bufferMs}`)
    if (Number(s.audio.outputBufferMs) > 0) args.push(`--audio-output-buffer=${s.audio.outputBufferMs}`)
  }

  if (mode === 'camera') {
    args.push('--video-source=camera')
    if (s.camera.size) args.push(`--camera-size=${s.camera.size}`)
    if (s.camera.facing) args.push(`--camera-facing=${s.camera.facing}`)
    if (Number(s.camera.fps) > 0) args.push(`--camera-fps=${s.camera.fps}`)
  }

  if (s.window.fullscreen) {
    args.push('--fullscreen')
  } else if (rect) {
    args.push(`--window-x=${rect.x}`, `--window-y=${rect.y}`, `--window-width=${rect.width}`, `--window-height=${rect.height}`)
  }
  if (s.window.borderless || s.frame.enabled) args.push('--window-borderless')
  if (s.window.alwaysOnTop || (mode !== 'otg' && rect)) args.push('--always-on-top')
  if (s.window.disableScreensaver) args.push('--disable-screensaver')

  if (s.device.showTouches) args.push('--show-touches')
  if (s.device.stayAwake) args.push('--stay-awake')
  if (s.device.powerOffOnClose) args.push('--power-off-on-close')

  if (s.input.mouseMode) args.push(`--mouse=${s.input.mouseMode}`)
  if (s.input.mouseBind && s.input.mouseBind !== 'bhsn') args.push(`--mouse-bind=${s.input.mouseBind}`)
  if (s.input.keyboardMode) args.push(`--keyboard=${s.input.keyboardMode}`)
  if (s.input.gamepad && s.input.gamepad !== 'disabled') args.push(`--game-pad=${s.input.gamepad}`)

  if (mode === 'record' && recordPath) {
    args.push(`--record=${recordPath}`, `--record-format=${s.record.format || 'mp4'}`)
    if (Number(s.record.durationSec) > 0) args.push(`--time-limit=${s.record.durationSec}`)
    if (s.record.noPlayback) args.push('--no-playback')
    if (s.record.noAudioPlayback) args.push('--no-audio-playback')
  }

  args.push(...tokenize(s.general.scrcpyExtraArgs), ...tokenize(overrides.rawArgs))
  return args
}

export async function startSession({ deviceId, platform = 'android', deviceName = '', mode = 'mirror', overrides = {} }) {
  if (platform === 'harmonyos') {
    return startHosSession({ deviceId, deviceName, mode, overrides })
  }
  if (platform === 'android' && (mode === 'mirror' || mode === 'flexible')) {
    return startAndroidUnifiedSession({ deviceId, deviceName, mode, overrides })
  }
  const bin = scrcpyBin()
  if (!bin) {
    return { ok: false, message: '未找到 scrcpy，请在「设置 → 通用」中指定路径（Android 投屏必需）' }
  }

  const s = configStore.get()
  const ratio = await getDeviceScreenSize(platform, deviceId, mode, s)
  if (ratio) logger.debug('[scrcpy] 设备屏幕比例', ratio)
  const rect = s.window.fullscreen ? null : resolveWindowRect(s.window, ratio)

  let recordPath = null
  if (mode === 'record') {
    const fileName = `录制-${deviceName || deviceId}-${Date.now()}.${s.record.format || 'mp4'}`
    recordPath = join(storageDir('videos'), fileName)
  }

  const windowTitle = `星点投屏 · ${deviceName || deviceId} · ${deviceId}`

  const useReadyShow = !!rect && mode !== 'otg' && mode !== 'flexible'
  let spawnRect = rect
  if (useReadyShow) {
    const minX = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
    spawnRect = { ...rect, x: minX - rect.width - 200, y: rect.y }
  }

  const args = buildArgs({
    serial: deviceId,
    mode,
    overrides: { ...overrides, windowTitle },
    rect: useReadyShow ? spawnRect : rect,
    recordPath
  })

  logger.info('[scrcpy] 启动会话', { deviceId, platform, mode, args: args.join(' ') })

  const child = spawn(bin, args, { windowsHide: true, env: toolsEnv() })
  const sessionId = `s${++seq}-${Date.now()}`
  const session = {
    id: sessionId,
    deviceId,
    platform,
    deviceName,
    mode,
    pid: child.pid,
    child,
    rect,
    recordPath,
    windowTitle,
    topmost: !!s.window.alwaysOnTop || (mode !== 'otg' && !!rect),
    startedAt: Date.now(),
    stderrTail: '',
    stdoutTail: '',
    revealed: false,
    winFound: false,
    hidePoll: null,
    timers: []
  }
  sessions.set(sessionId, session)

  let innerRadius = 0
  if (mode !== 'otg' && rect) {
    const model = s.frame.enabled ? getFrameModel(s.frame.model) : getFrameModel('none')
    const payload = {
      sessionId,
      rect,
      model,
      opacity: s.frame.opacity,
      device: { id: deviceId, name: deviceName, platform },
      windowTitle,
      topmost: session.topmost
    }
    openFrameWindow(sessionId, payload)
    innerRadius = payload.innerRadius || 0
  }

  let mirrorShown = false
  const showMirror = () => {
    if (mirrorShown || !useReadyShow || !rect) return
    const q = queryWindow(windowTitle)
    if (!q.found) return
    mirrorShown = true
    const phys = screen.dipToScreenPoint({ x: rect.x, y: rect.y })
    moveWindow(windowTitle, phys.x, phys.y)
    if (innerRadius > 0) setWindowCorners(windowTitle, innerRadius)
    showWindow(windowTitle)
    logger.debug('[scrcpy] 镜像窗口就位显示', sessionId, phys, 'innerRadius', innerRadius)
  }

  let presented = false
  let presentDone = false
  const present = async () => {
    if (presented) return
    presented = true
    await Promise.race([waitForFrameReady(sessionId), new Promise((r) => setTimeout(r, 1200))])
    showFrameWindow(sessionId)
    showMirror()
    presentDone = true
    if (s.general.floatingControlBar && mode !== 'otg') {
      openControlsWindow(sessionId, {
        sessionId,
        deviceId,
        platform,
        deviceName: deviceName || deviceId
      })
    }
  }

  const reveal = () => {
    if (session.revealed) return
    session.revealed = true
    present()
    if (mode !== 'otg' && rect) {
      for (const delay of [800, 2200, 4800]) {
        session.timers.push(setTimeout(() => alignOverlays(sessionId), delay))
      }
    }
    logger.debug('[scrcpy] 会话就绪', sessionId)
  }

  child.stderr.on('data', (d) => {
    const text = d.toString()
    session.stderrTail = (session.stderrTail + text).slice(-2000)
    logger.debug('[scrcpy:err]', text.trim())
  })
  child.stdout.on('data', (d) => {
    const text = d.toString()
    session.stdoutTail = (session.stdoutTail + text).slice(-2000)
    logger.debug('[scrcpy:out]', text.trim())
    if (useReadyShow && !session.revealed && /Texture.*\d+x\d+/.test(session.stdoutTail)) {
      logger.debug('[scrcpy] 首帧就绪', sessionId)
      reveal()
    }
  })
  child.on('error', (err) => {
    logger.error('[scrcpy] 进程错误', err.message)
    session.stderrTail += `\n${err.message}`
  })
  child.on('exit', (code) => {
    logger.info('[scrcpy] 会话结束', sessionId, 'exit', code)
    finishSession(sessionId, code, (session.stderrTail || '').trim().slice(-500))
  })

  if (useReadyShow) {
    let polls = 0
    session.hidePoll = setInterval(() => {
      if (++polls > 150) {
        clearInterval(session.hidePoll)
        session.hidePoll = null
        return
      }
      const q = queryWindow(windowTitle)
      if (!q.found) return
      session.winFound = true
      if (session.revealed) {
        if (presentDone) showMirror()
        if (mirrorShown) {
          clearInterval(session.hidePoll)
          session.hidePoll = null
        }
      } else if (q.visible) {
        hideWindow(windowTitle)
      }
    }, 60)
    if (!s.video.enabled) {
      session.timers.push(setTimeout(() => {
        if (session.winFound) reveal()
      }, 400))
    }
    const quickReveal = !s.video.enabled || (mode === 'record' && s.record.noPlayback)
    session.timers.push(setTimeout(reveal, quickReveal ? 1500 : 5000))
  } else {
    reveal()
  }

  return {
    ok: true,
    sessionId,
    rect,
    recordPath,
    message: mode === 'record' ? `录制中，输出：${recordPath}` : '投屏已启动'
  }
}

async function startAndroidUnifiedSession({ deviceId, deviceName, mode, overrides = {} }) {
  const s = configStore.get()
  const sessionId = `s${++seq}-${Date.now()}`
  let revealRef = () => {}
  let frameWin = null
  let stream = null

  const raw = typeof overrides.rawArgs === 'string' ? overrides.rawArgs : ''
  const numArg = (name, def) => {
    const m = new RegExp(`--${name}[=\\s]+(\\d+)`).exec(raw)
    return m ? parseInt(m[1], 10) : def
  }
  const maxSize = numArg('max-size', 0)
  const videoBitRate = numArg('video-bit-rate', 8000000)
  const maxFps = numArg('max-fps', 0)

  let dims
  try {
    stream = await startScrcpyStream(deviceId, {
      maxSize,
      videoBitRate,
      maxFps,
      autoStart: true,
      onFirstFrame: () => revealRef(),
      onFrame: (buf) => {
        if (frameWin && !frameWin.isDestroyed()) frameWin.webContents.send('scrcpy:frame', buf)
      },
      onError: (message) => {
        if (frameWin && frameWin.isDestroyed()) return
        logger.error('[scrcpy-unified] 投屏中断', sessionId, message)
        finishSession(sessionId, 1, message)
      }
    })
    dims = stream.dims
  } catch (e) {
    logger.error('[scrcpy-unified] 裸流启动失败', deviceId, e.message)
    return { ok: false, message: e.message }
  }

  const rect = s.window.fullscreen ? null : resolveWindowRect(s.window, dims, true)
  const windowTitle = `星点投屏 · ${deviceName || deviceId} · ${deviceId}`
  const topmost = !!s.window.alwaysOnTop || !!rect
  const model = s.frame.enabled ? getFrameModel(s.frame.model) : getFrameModel('none')
  const framePayload = {
    sessionId,
    rect,
    model,
    opacity: s.frame.opacity,
    device: { id: deviceId, name: deviceName, platform: 'android' },
    windowTitle,
    topmost,
    unified: true,
    stream: 'scrcpy',
    deviceSize: dims
  }
  frameWin = openFrameWindow(sessionId, framePayload)

  const session = {
    id: sessionId,
    deviceId,
    platform: 'android',
    deviceName,
    mode,
    pid: null,
    child: null,
    rect,
    recordPath: null,
    windowTitle,
    topmost,
    startedAt: Date.now(),
    stderrTail: '',
    stdoutTail: '',
    revealed: false,
    winFound: true,
    hidePoll: null,
    timers: [],
    stream,
    streamWin: frameWin,
    deviceSize: dims,
    inputTarget: frameWin.webContents.id
  }
  sessions.set(sessionId, session)
  logger.info('[scrcpy-unified] 会话已建立（一体模式）', { deviceId, dims, rect })

  frameWin.on('closed', () => {
    logger.info('[scrcpy-unified] 窗口关闭', sessionId)
    finishSession(sessionId, 0, '镜像窗口已关闭')
  })

  let presented = false
  const present = async () => {
    if (presented) return
    presented = true
    await Promise.race([waitForFrameReady(sessionId), new Promise((r) => setTimeout(r, 1200))])
    showFrameWindow(sessionId)
    if (!frameWin.isDestroyed()) frameWin.moveTop()
    if (s.general.floatingControlBar) {
      openControlsWindow(sessionId, { sessionId, deviceId, platform: 'android', deviceName: deviceName || deviceId })
    }
  }
  const reveal = () => {
    if (session.revealed) return
    session.revealed = true
    present()
    logger.debug('[scrcpy-unified] 会话就绪', sessionId)
  }
  revealRef = reveal
  session.timers.push(setTimeout(reveal, 5000))

  return { ok: true, sessionId, rect, recordPath: null, message: '投屏已启动' }
}

async function startHosSession({ deviceId, deviceName, mode, overrides = {} }) {
  if (mode !== 'mirror') {
    return { ok: false, message: '鸿蒙设备暂仅支持「镜像」模式（录制/相机/OTG 依赖 scrcpy）' }
  }
  const s = configStore.get()
  const sessionId = `s${++seq}-${Date.now()}`
  let revealRef = () => {}
  let frameWin = null

  let sidecar
  try {
    sidecar = await startHosSidecar(deviceId, {
      autoStart: false,
      onFirstFrame: () => revealRef(),
      onFrame: (buf) => {
        if (frameWin && !frameWin.isDestroyed()) frameWin.webContents.send('hos:frame', buf)
      },
      onError: (message) => {
        if (frameWin && frameWin.isDestroyed()) return
        logger.error('[hos] 投屏中断', sessionId, message)
        finishSession(sessionId, 1, message)
      }
    })
  } catch (e) {
    logger.error('[hos] sidecar 启动失败', deviceId, e.message)
    return { ok: false, message: e.message }
  }

  const dims = sidecar.dims
  const rect = s.window.fullscreen ? null : resolveWindowRect(s.window, dims, true)
  const windowTitle = `星点投屏 · ${deviceName || deviceId} · ${deviceId}`
  const topmost = !!s.window.alwaysOnTop || !!rect

  const model = s.frame.enabled ? getFrameModel(s.frame.model) : getFrameModel('none')
  const framePayload = {
    sessionId,
    rect,
    model,
    opacity: s.frame.opacity,
    device: { id: deviceId, name: deviceName, platform: 'harmonyos' },
    windowTitle,
    topmost,
    unified: true,
    stream: 'hos',
    deviceSize: dims
  }
  frameWin = openFrameWindow(sessionId, framePayload)

  const session = {
    id: sessionId,
    deviceId,
    platform: 'harmonyos',
    deviceName,
    mode,
    pid: null,
    child: null,
    rect,
    recordPath: null,
    windowTitle,
    topmost,
    startedAt: Date.now(),
    stderrTail: '',
    stdoutTail: '',
    revealed: false,
    winFound: true,
    hidePoll: null,
    timers: [],
    hos: sidecar,
    hosWin: frameWin,
    inputTarget: frameWin.webContents.id
  }
  sessions.set(sessionId, session)
  logger.info('[hos] 会话已建立（一体模式）', { deviceId, dims, rect })

  frameWin.on('closed', () => {
    logger.info('[hos] 窗口关闭', sessionId)
    finishSession(sessionId, 0, '镜像窗口已关闭')
  })

  let presented = false
  const present = async () => {
    if (presented) return
    presented = true
    await Promise.race([waitForFrameReady(sessionId), new Promise((r) => setTimeout(r, 1200))])
    showFrameWindow(sessionId)
    if (!frameWin.isDestroyed()) frameWin.moveTop()
    if (s.general.floatingControlBar) {
      openControlsWindow(sessionId, { sessionId, deviceId, platform: 'harmonyos', deviceName: deviceName || deviceId })
    }
  }
  const reveal = () => {
    if (session.revealed) return
    session.revealed = true
    present()
    logger.debug('[hos] 会话就绪', sessionId)
  }
  revealRef = reveal
  session.timers.push(setTimeout(reveal, 4000))

  sidecar.screen('video')

  return { ok: true, sessionId, rect, recordPath: null, message: '投屏已启动' }
}

function finishSession(sessionId, code, message) {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  for (const t of session.timers) clearTimeout(t)
  if (session.hidePoll) clearInterval(session.hidePoll)
  if (session.hos) {
    try { session.hos.stop() } catch {}
  }
  if (session.stream) {
    try { session.stream.stop() } catch {}
  }
  closeFrameWindow(sessionId)
  closeControlsWindow(sessionId)
  let cleanMessage = (message || '').trim()
  const lines = cleanMessage.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const realErrors = lines.filter((l) =>
    /error|exception|abort|failed|fatal|cannot|denied/i.test(l) && !/file pushed/i.test(l)
  )
  cleanMessage = realErrors.length ? realErrors.slice(-1)[0] : ''
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('scrcpy:session-ended', {
      sessionId,
      deviceId: session.deviceId,
      mode: session.mode,
      code,
      message: cleanMessage.slice(0, 200)
    })
  }
}

export function stopSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, message: '会话不存在' }
  if (session.hos || session.stream) {
    finishSession(sessionId, 0, '已停止')
    return { ok: true, message: '已停止' }
  }
  session.child?.kill?.()
  return { ok: true, message: '已停止' }
}

export function killAllSessions() {
  for (const session of [...sessions.values()]) {
    if (session.hos || session.stream) {
      finishSession(session.id, 0, '已停止')
      continue
    }
    try {
      process.kill(session.pid)
    } catch {}
  }
  sessions.clear()
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    deviceId: s.deviceId,
    platform: s.platform,
    deviceName: s.deviceName,
    mode: s.mode,
    recordPath: s.recordPath,
    startedAt: s.startedAt
  }))
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null
}
