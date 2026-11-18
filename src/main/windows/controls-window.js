import { BrowserWindow, app, screen } from 'electron'
import { logger } from '../logger.js'
import { resourcePath, preloadPath } from '../services/paths.js'

const payloadByWcId = new Map()
const windowsBySession = new Map()

export function getControlsPayload(senderId) {
  const payload = payloadByWcId.get(senderId) || null
  logger.debug('[controls] get-payload', senderId, payload ? payload.sessionId : 'null')
  return payload
}

export function openControlsWindow(sessionId, payload) {
  closeControlsWindow(sessionId)

  const area = screen.getPrimaryDisplay().workArea
  const width = 56
  const height = 372
  const bounds = {
    x: area.x + area.width - width - 18,
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height
  }
  logger.debug('[controls] 打开浮动控制栏', sessionId, bounds)

  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const wcId = win.webContents.id
  payloadByWcId.set(wcId, payload)
  windowsBySession.set(sessionId, win)

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })

  win.on('closed', () => {
    payloadByWcId.delete(wcId)
    windowsBySession.delete(sessionId)
  })

  win.loadFile(resourcePath('controls', 'index.html'))
  return win
}

export function closeControlsWindow(sessionId) {
  const win = windowsBySession.get(sessionId)
  if (win && !win.isDestroyed()) win.close()
  windowsBySession.delete(sessionId)
}

export function closeAllControlsWindows() {
  for (const win of windowsBySession.values()) {
    if (win && !win.isDestroyed()) win.close()
  }
  windowsBySession.clear()
  payloadByWcId.clear()
}
