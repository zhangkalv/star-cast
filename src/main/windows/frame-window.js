import { BrowserWindow, app, screen } from 'electron'
import { logger } from '../logger.js'
import { resourcePath, preloadPath } from '../services/paths.js'
import { queryWindow, startDragLoop, waitMouseRelease } from '../services/win32-window.js'

// 机型边框窗口：数据链路为「页面主动拉取 frame:get-payload + dom-ready + 延时兜底」三重机制，
// 不依赖 did-finish-load 推送（曾出现事件不触发导致边框不显示的问题）。
const payloadByWcId = new Map()
const sessions = new Map() // sessionId -> { payload, frameWin, outer, showBezel, innerRadius }
const watchers = new Map()
const drags = new Map() // sessionId -> { loop }

// ---------- DPI 换算（Win32 返回物理像素，Electron 窗口用 DIP） ----------
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
  // 一体模式：边框窗口就是整个外壳，screenRect 已是 outer
  const outer = meta.unified ? screenRect : meta.showBezel ? frameBoundsFor(screenRect, meta.payload.model) : screenRect
  meta.outer = outer
  if (meta.frameWin && !meta.frameWin.isDestroyed()) meta.frameWin.setBounds(outer)
}

/**
 * 打开镜像外壳：机型边框（透明可拖动，内嵌 置顶/最小化/关闭 图标按钮）。
 * 窗口隐藏加载，页面渲染完成（frame:rendered）后由 showFrameWindow 显示，
 * 供主流程与镜像窗口同帧显示，融为一体。
 * payload: { sessionId, rect, model, opacity, device, windowTitle, topmost }
 */
export function openFrameWindow(sessionId, payload) {
  closeFrameWindow(sessionId)

  const model = payload.model
  const showBezel = !!model && model.id !== 'none'
  // 屏幕圆角取内外圆角的几何均值：贴合边框内圈椭圆曲线，四角缝隙最小
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

  // 一体模式（鸿蒙 H.264）：画面直接画在边框洞里，窗口需接收鼠标做触控与拖动
  const unified = !!payload.unified
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
    // 一体模式下窗口承载画面、触控与拖放文件，需要可聚焦才能接收 drop
    focusable: !!unified,
    alwaysOnTop: true,
    // 一体投屏窗口作为独立任务显示在 Windows 任务栏；非一体的旧边框窗口仍隐藏
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

  // Windows 任务栏按 AppUserModelId 分组：主窗口用进程级 'com.star.cast'，
  // 投屏窗口必须换成独立 AppId，否则会被合并进主窗口按钮，没有"单独的任务栏"。
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
  // 兜底：渲染信号丢失（如页面异常）也不能卡住显示
  const readyTimer = setTimeout(resolveReady, 2500)

  frameWin.webContents.on('did-finish-load', () => {
    logger.debug('[frame] did-finish-load（数据以页面拉取为准）', sessionId)
    if (!frameWin.isDestroyed()) frameWin.webContents.send('frame:payload-updated', payload)
  })

  // 诊断：临时转发边框页面 console（WebCodecs 解码状态默认看不到）
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

/** 边框页面完成渲染（样式已上屏）后调用，解除显示等待 */
export function markFrameRendered(senderId) {
  const payload = payloadByWcId.get(senderId)
  if (!payload) return
  const meta = sessions.get(payload.sessionId)
  if (meta && meta.resolveFrameReady) meta.resolveFrameReady()
}

/** 等待边框渲染完成（含超时兜底由 openFrameWindow 内部保证） */
export function waitForFrameReady(sessionId) {
  const meta = sessions.get(sessionId)
  return (meta && meta.frameReady) || Promise.resolve()
}

/** 显示边框窗口（与镜像窗口同帧调用，实现「同时出」） */
export function showFrameWindow(sessionId) {
  const meta = sessions.get(sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed() || meta.frameShown) return
  meta.frameShown = true
  meta.frameWin.showInactive()
  meta.frameWin.moveTop()
  // 透明窗口在 canvas 首帧绘制后合成层可能不刷新，表现为刚启动时画面全黑、
  // 切换多次页面才恢复。延时强制重绘（invalidate + 微小位移回原位）触发合成器更新。
  const repaint = () => {
    if (!meta.frameWin || meta.frameWin.isDestroyed()) return
    try {
      meta.frameWin.webContents.invalidate()
      const b = meta.frameWin.getBounds()
      meta.frameWin.setBounds({ ...b, x: b.x + 1 })
      meta.frameWin.setBounds(b)
      meta.frameWin.moveTop()
    } catch {}
  }
  setTimeout(repaint, 120)
  setTimeout(repaint, 500)
  setTimeout(repaint, 1500)
  // 不做窗口级 SetWindowRgn：GDI 区域裁剪是硬边无抗锯齿，拖动时四角会明显锯齿。
  // 外圈圆角完全由 CSS bezel 的 border-radius 绘制（抗锯齿），窗口透明四角透出桌面即圆角效果。
  logger.debug('[frame] 边框显示', sessionId)
}

/**
 * 将外壳对齐到 scrcpy 实际窗口位置（Win32 查询真实矩形，容忍 scrcpy 自适应调整）。
 * 窗口最小化时隐藏外壳，恢复后自动重新显示并对齐。
 */
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
  // 仅在「已同帧显示」之后才允许对齐时重新显示（避免边框抢在镜像前出现）
  if (meta.frameShown && meta.frameWin && !meta.frameWin.isDestroyed()) {
    meta.frameWin.showInactive()
    meta.frameWin.moveTop()
  }
  logger.debug('[frame] 已对齐', sessionId, dipRect)
}

/** 鼠标位于边框环上时捕获事件（可拖动），位于屏幕区域时点击穿透给 scrcpy */
export function setFrameMouseState(senderId, ring) {
  const payload = payloadByWcId.get(senderId)
  if (!payload) return
  const meta = sessions.get(payload.sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed()) return
  if (drags.has(payload.sessionId)) return
  // 一体模式：窗口里就是画面，始终接收鼠标（洞内转发触控、边框区拖动由页面区分）
  if (meta.unified) return
  meta.frameWin.setIgnoreMouseEvents(!ring, { forward: true })
}

/** 边框窗口与镜像窗口同进退的置顶切换（防止 z 序脱节），边框始终压在镜像之上 */
export function setFrameTopmost(sessionId, on) {
  const meta = sessions.get(sessionId)
  if (!meta || !meta.frameWin || meta.frameWin.isDestroyed()) return
  meta.frameWin.setAlwaysOnTop(!!on)
  if (on) meta.frameWin.moveTop()
}

/**
 * 拖动移动镜像窗口：Win32 dragloop 跟随光标移动 scrcpy 窗口，
 * 主进程同步移动边框（松开左键自动结束并重新对齐）。
 */
export function startWindowDrag(sessionId) {
  const meta = sessions.get(sessionId)
  if (!meta) return { ok: false, message: '会话不存在' }
  if (drags.has(sessionId)) return { ok: true }

  // 一体模式（鸿蒙）：frame 窗口本身就是画面。用 Electron setBounds 跟随光标，
  // 松手检测交给 helper 的 waitrelease（Windows 层 GetAsyncKeyState）——
  // 渲染层 mouseup 在鼠标移出窗口时会丢失，导致窗口一直跟鼠标。
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
  // 窗口最小化时 GetWindowRect 返回 -32000 等无效坐标，拖动偏移会算成几万像素，
  // 把边框窗口甩飞（表现为「边框不见」）。最小化/异常尺寸时直接拒绝拖动。
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
    // 拖动结束：按当前光标位置恢复穿透状态并精确对齐
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
      meta.frameWin.setIgnoreMouseEvents(inInner, { forward: true })
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

/** 最小化后轮询等待窗口恢复，恢复即重新显示并对齐 */
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

/** 更新边框 payload（如置顶状态）并推送给边框页面 */
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
