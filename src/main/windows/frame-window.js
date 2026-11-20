import { BrowserWindow, app, screen } from 'electron'
import { logger } from '../logger.js'
import { resourcePath, preloadPath } from '../services/paths.js'
import { queryWindow, startDragLoop, waitMouseRelease } from '../services/win32-window.js'

const payloadByWcId = new Map()
const sessions = new Map() // sessionId -> { payload, frameWin, outer, showBezel, innerRadius }
const watchers = new Map()
const topmostTimers = new Map() // sessionId -> timer（置顶看门狗）
const drags = new Map() // sessionId -> { loop }

function physToDip(rect) {
  try {
    return screen.screenToDipRect(null, rect)
  } catch {
    return rect
  }
}

function dipToPhysPoint(point) {
  try {
    return screen.dipToScreenPoint(point)
  } catch {
    return point
  }
}

export function getFramePayload(senderId) {
  const payload = payloadByWcId.get(senderId) || null
  logger.debug('[frame] get-payload', senderId, payload ? payload.sessionId : 'null')
  return payload
}

function frameBoundsFor(rect, model) {
  return {
    x: rect.x - model.padding.left,
    y: rect.y - model.padding.top,
    width: rect.width + model.padding.left + model.padding.right,
    height: rect.height + model.padding.top + model.padding.bottom
  }
}

function applyOverlayBounds(sessionId, screenRect) {
  const meta = sessions.get(sessionId)
  if (!meta) return
  const outer = meta.unified ? screenRect : meta.showBezel ? frameBoundsFor(screenRect, meta.payload.model) : screenRect
  meta.outer = outer
  if (meta.frameWin && !meta.frameWin.isDestroyed()) meta.frameWin.setBounds(outer)
}

export function openFrameWindow(sessionId, payload) {
  closeFrameWindow(sessionId)

  const model = payload.model
  const showBezel = !!model && model.id !== 'none'
  const innerRadius = showBezel
    ? Math.round(
        Math.sqrt(
          Math.max(0, model.radius - Math.min(model.padding.left, model.padding.right)) *
            Math.max(0, model.radius - Math.min(model.padding.top, model.padding.bottom))
        )
      )
    : 0
  const outer = showBezel ? frameBoundsFor(payload.rect, model) : { ...payload.rect }
  payload.innerRadius = innerRadius

  logger.debug('[frame] 打开外壳', sessionId, { showBezel, outer, innerRadius })

  const unified = !!payload.unified
  const wantTopmost = payload.topmost !== false
  const frameWin = new BrowserWindow({
    ...outer,
    ...(unified ? { title: payload.windowTitle } : {}),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: !!unified,
    maximizable: false,
    fullscreenable: false,
    focusable: !!unified,
    alwaysOnTop: unified ? wantTopmost : true,
    skipTaskbar: !unified,
    ...(unified ? { icon: resourcePath('logo.png') } : {}),
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  frameWin.setIgnoreMouseEvents(!unified, { forward: true })

  if (unified && process.platform === 'win32') {
    try {
      frameWin.setAppDetails({ appId: 'com.star.cast.player' })
    } catch (e) {
      logger.warn('[frame] setAppDetails 失败', e && e.message)
    }
  }

  const wcId = frameWin.webContents.id
  payloadByWcId.set(wcId, payload)

  let resolveReady = () => {}
  const frameReady = new Promise((resolve) => {
    resolveReady = resolve
  })
  const readyTimer = setTimeout(resolveReady, 2500)

  frameWin.webContents.on('did-finish-load', () => {
    logger.debug('[frame] did-finish-load（数据以页面拉取为准）', sessionId)
    if (!frameWin.isDestroyed()) frameWin.webContents.send('frame:payload-updated', payload)
  })

  frameWin.webContents.on('console-message', (_e, level, message) => {
    logger.debug('[frame:page]', `L${level}`, message)
  })

  frameWin.on('closed', () => {
    logger.debug('[frame] 窗口关闭', sessionId)
    payloadByWcId.delete(wcId)
  })

  frameWin.loadFile(resourcePath('frame', 'index.html'))

  sessions.set(sessionId, {
    payload,
    frameWin,
    outer,
    showBezel,
    unified,
    innerRadius,
    frameShown: false,
    frameReady,
    resolveFrameReady: () => {
      clearTimeout(readyTimer)
      resolveReady()
    }
  })
  return frameWin
}

export function markFrameRendered(senderId) {
  const payload = payloadByWcId.get(senderId)
  if (!payload) return
  const meta = sessions.get(payload.sessionId)
  if (meta && meta.resolveFrameReady) meta.resolveFrameReady()
}

export function waitForFrameReady(sessionId) {
  const meta = sessions.get(sessionId)
  return (meta && meta.frameReady) || Promise.resolve()
}

export function showFrameWindow(sessionId) {
  const meta = sessions.get(sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed() || meta.frameShown) return
  meta.frameShown = true
  meta.frameWin.showInactive()
  const repaint = () => {
    if (!meta.frameWin || meta.frameWin.isDestroyed()) return
    try {
      meta.frameWin.webContents.invalidate()
      const b = meta.frameWin.getBounds()
      meta.frameWin.setBounds({ ...b, x: b.x + 1 })
      meta.frameWin.setBounds(b)
    } catch {}
  }
  setTimeout(repaint, 120)
  setTimeout(repaint, 500)
  setTimeout(repaint, 1500)
  const wantOn = meta.payload ? meta.payload.topmost !== false : true
  if (wantOn) applyTopmost(meta, true)
  logger.debug('[frame] 边框显示', sessionId)
}

export function alignOverlays(sessionId) {
  const meta = sessions.get(sessionId)
  if (!meta) return
  const title = meta.payload.windowTitle
  if (!title) return
  const q = queryWindow(title)
  if (!q.found) {
    logger.debug('[frame] 未找到镜像窗口，跳过对齐', sessionId, title)
    return
  }

  if (q.iconic) {
    logger.debug('[frame] 镜像窗口已最小化，隐藏外壳', sessionId)
    if (meta.frameWin && !meta.frameWin.isDestroyed()) meta.frameWin.hide()
    return
  }

  const dipRect = physToDip({ x: q.x, y: q.y, width: q.width, height: q.height })
  applyOverlayBounds(sessionId, dipRect)
  if (meta.frameShown && meta.frameWin && !meta.frameWin.isDestroyed()) {
    meta.frameWin.showInactive()
    if (meta.frameWin.isAlwaysOnTop()) pinTopmost(meta)
  }
  logger.debug('[frame] 已对齐', sessionId, dipRect)
}

export function setFrameMouseState(senderId, ring) {
  const payload = payloadByWcId.get(senderId)
  if (!payload) return
  const meta = sessions.get(payload.sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed()) return
  if (drags.has(payload.sessionId)) return
  if (meta.unified) return
  try {
    meta.frameWin.setIgnoreMouseEvents(!ring, { forward: true })
    // 点击穿透切换会重写 GWL_EXSTYLE，把窗口踢出置顶带，需立即重新钉住
    if (meta.frameWin.isAlwaysOnTop()) setTimeout(() => pinTopmost(meta), 0)
  } catch {}
}

export function setFrameTopmost(sessionId, on) {
  const meta = sessions.get(sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed()) return
  applyTopmost(meta, !!on)
}

function pinTopmost(meta) {
  const win = meta && meta.frameWin
  if (!win || win.isDestroyed()) return
  // screen-saver 级别会在 Windows 上重新走 SetWindowPos(HWND_TOPMOST)，
  // 不移动、不缩放、不抢焦点，可修复“样式位为真但已掉出置顶带”的情况
  try { win.setAlwaysOnTop(true, 'screen-saver') } catch {}
}

function stopTopmostWatchdog(sessionId) {
  const timer = topmostTimers.get(sessionId)
  if (timer) clearInterval(timer)
  topmostTimers.delete(sessionId)
}

function applyTopmost(meta, on) {
  const sessionId = meta.payload && meta.payload.sessionId
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed()) return
  const win = meta.frameWin
  try { win.setAlwaysOnTop(!!on, on ? 'screen-saver' : 'floating') } catch {}
  if (on) {
    pinTopmost(meta)
    stopTopmostWatchdog(sessionId)
    const timer = setInterval(() => pinTopmost(meta), 3000)
    topmostTimers.set(sessionId, timer)
    setTimeout(() => pinTopmost(meta), 150)
  } else {
    stopTopmostWatchdog(sessionId)
  }
  logger.info('[frame] topmost', sessionId, on)
}

export function raiseFrameWindow(win) {
  if (!win || win.isDestroyed()) return
  for (const meta of sessions.values()) {
    if (meta.frameWin === win) { applyTopmost(meta, true); return }
  }
}

export function startWindowDrag(sessionId) {
  const meta = sessions.get(sessionId)
  if (!meta) return { ok: false, message: '会话不存在' }
  if (drags.has(sessionId)) return { ok: true }

  if (meta.unified && meta.frameWin && !meta.frameWin.isDestroyed()) {
    const start = screen.getCursorScreenPoint()
    const b = meta.frameWin.getBounds()
    const offX = start.x - b.x
    const offY = start.y - b.y
    const endDrag = () => {
      clearInterval(timer)
      release?.kill()
      drags.delete(sessionId)
    }
    const timer = setInterval(() => {
      if (!meta.frameWin || meta.frameWin.isDestroyed()) return
      const c = screen.getCursorScreenPoint()
      meta.frameWin.setBounds({ x: c.x - offX, y: c.y - offY, width: b.width, height: b.height })
    }, 16)
    const release = waitMouseRelease(endDrag)
    drags.set(sessionId, { loop: release, timer })
    return { ok: true }
  }

  const title = meta.payload.windowTitle
  const q = queryWindow(title)
  if (!q.found) return { ok: false, message: '未找到镜像窗口' }
  if (q.iconic || q.width <= 0 || q.height <= 0 || Math.abs(q.x) > 30000 || Math.abs(q.y) > 30000) {
    logger.warn('[frame] 镜像窗口处于最小化/异常状态，忽略拖动', sessionId, q)
    return { ok: false, message: '窗口当前不可拖动' }
  }

  const cursorDip = screen.getCursorScreenPoint()
  const dipRect = physToDip({ x: q.x, y: q.y, width: q.width, height: q.height })
  const offDipX = cursorDip.x - dipRect.x
  const offDipY = cursorDip.y - dipRect.y
  const cursorPhys = dipToPhysPoint(cursorDip)
  const offPhysX = cursorPhys.x - q.x
  const offPhysY = cursorPhys.y - q.y

  logger.debug('[frame] 拖动开始', sessionId, { offDipX, offDipY, offPhysX, offPhysY })

  const loop = startDragLoop(title, offPhysX, offPhysY, () => {
    clearInterval(timer)
    drags.delete(sessionId)
    const c = screen.getCursorScreenPoint()
    const outer = meta.outer
    if (outer && meta.frameWin && !meta.frameWin.isDestroyed()) {
      const pad = meta.showBezel ? meta.payload.model.padding : { top: 0, right: 0, bottom: 0, left: 0 }
      const inner = {
        x: outer.x + pad.left,
        y: outer.y + pad.top,
        width: outer.width - pad.left - pad.right,
        height: outer.height - pad.top - pad.bottom
      }
      const inInner =
        c.x >= inner.x && c.x <= inner.x + inner.width && c.y >= inner.y && c.y <= inner.y + inner.height
      try {
        meta.frameWin.setIgnoreMouseEvents(inInner, { forward: true })
        if (meta.frameWin.isAlwaysOnTop()) setTimeout(() => pinTopmost(meta), 0)
      } catch {}
    }
    alignOverlays(sessionId)
    logger.debug('[frame] 拖动结束', sessionId)
  })

  const timer = setInterval(() => {
    const c = screen.getCursorScreenPoint()
    applyOverlayBounds(sessionId, {
      x: c.x - offDipX,
      y: c.y - offDipY,
      width: dipRect.width,
      height: dipRect.height
    })
  }, 25)

  drags.set(sessionId, { loop, timer })
  return { ok: true }
}

export function stopWindowDrag(sessionId) {
  const st = drags.get(sessionId)
  if (st) {
    try { st.loop?.kill() } catch {}
    if (st.timer) clearInterval(st.timer)
    drags.delete(sessionId)
  }
}

export function startRestoreWatcher(sessionId) {
  stopRestoreWatcher(sessionId)
  const timer = setInterval(() => {
    const meta = sessions.get(sessionId)
    if (!meta) {
      stopRestoreWatcher(sessionId)
      return
    }
    const q = queryWindow(meta.payload.windowTitle)
    if (!q.found) {
      stopRestoreWatcher(sessionId)
      return
    }
    if (!q.iconic) {
      logger.debug('[frame] 镜像窗口已恢复', sessionId)
      alignOverlays(sessionId)
      stopRestoreWatcher(sessionId)
    }
  }, 1200)
  watchers.set(sessionId, timer)
}

export function stopRestoreWatcher(sessionId) {
  const timer = watchers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    watchers.delete(sessionId)
  }
}

export function closeFrameWindow(sessionId) {
  stopRestoreWatcher(sessionId)
  stopTopmostWatchdog(sessionId)
  stopWindowDrag(sessionId)
  const st = drags.get(sessionId)
  if (st) {
    clearInterval(st.timer)
    drags.delete(sessionId)
  }
  const meta = sessions.get(sessionId)
  if (meta && meta.frameWin && !meta.frameWin.isDestroyed()) meta.frameWin.close()
  sessions.delete(sessionId)
}

export function closeAllFrameWindows() {
  for (const sessionId of [...sessions.keys()]) {
    closeFrameWindow(sessionId)
  }
  payloadByWcId.clear()
}

export function updateFramePayload(sessionId, patch) {
  const meta = sessions.get(sessionId)
  if (meta) meta.payload = { ...meta.payload, ...patch }
  for (const [wcId, payload] of payloadByWcId) {
    if (payload.sessionId !== sessionId) continue
    const merged = { ...payload, ...patch }
    payloadByWcId.set(wcId, merged)
    if (meta && meta.frameWin && !meta.frameWin.isDestroyed() && meta.frameWin.webContents.id === wcId) {
      meta.frameWin.webContents.send('frame:payload-updated', merged)
    }
  }
}
