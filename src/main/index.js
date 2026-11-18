import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { logger } from './logger.js'
import { registerIpc } from './ipc.js'
import { createMainWindow, getMainWindow } from './windows/main-window.js'
import { closeAllFrameWindows } from './windows/frame-window.js'
import { closeAllControlsWindows } from './windows/controls-window.js'
import { killAllSessions } from './services/scrcpy.js'

// userData 固定为 %APPDATA%\star-record（配置/日志/脚本均按此约定），不受 productName 影响
app.setPath('userData', join(app.getPath('appData'), 'star-record'))
// Windows 任务栏使用独立 AppId，避免与其它 Electron 应用合并分组
if (process.platform === 'win32') app.setAppUserModelId('com.star.cast')

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    logger.info('[app] 星点投屏启动', {
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform
    })
    registerIpc()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    killAllSessions()
    closeAllControlsWindows()
    closeAllFrameWindows()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
