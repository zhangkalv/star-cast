import { BrowserWindow, shell, app } from 'electron'
import { join } from 'path'
import { logger } from '../logger.js'
import { configStore } from '../config.js'
import { resourcePath, preloadPath } from '../services/paths.js'

let mainWindow = null

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: !!configStore.get().window.alwaysOnTop,
    backgroundColor: '#0f1115',
    title: '星点投屏',
    icon: resourcePath('logo.png'),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(app.getAppPath(), 'out', 'renderer', 'index.html'))
  }
  logger.info('[main-window] 创建主窗口', devUrl || 'production')
  return mainWindow
}

export function getMainWindow() {
  return mainWindow
}
