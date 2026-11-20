import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

const subscribe = (channel) => (callback) => {
  const listener = (_event, data) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const starcast = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  app: {
    getInfo: () => invoke('app:get-info'),
    pickFile: (options) => invoke('app:pick-file', options),
    pickDirectory: () => invoke('app:pick-directory'),
    openPath: (p) => invoke('app:open-path', p),
    showItem: (p) => invoke('app:show-item', p),
    openExternal: (url) => invoke('app:open-external', url),
    checkUpdate: () => invoke('app:check-update'),
    openDownload: (url) => invoke('app:open-download', url)
  },
  config: {
    get: () => invoke('config:get'),
    set: (patch) => invoke('config:set', patch),
    reset: () => invoke('config:reset')
  },
  devices: {
    list: () => invoke('devices:list'),
    connectWifi: (host, port) => invoke('devices:connect-wifi', { host, port }),
    disconnect: (deviceId) => invoke('devices:disconnect', deviceId)
  },
  device: {
    screenshot: (deviceId) => invoke('device:screenshot', deviceId),
    install: (deviceId, filePath) => invoke('device:install', { deviceId, filePath }),
    listPackages: (deviceId) => invoke('device:list-packages', deviceId),
    appLabels: (deviceId, packages) => invoke('device:app-labels', { deviceId, packages }),
    uninstall: (deviceId, packageName) => invoke('device:uninstall', { deviceId, packageName }),
    launchPackage: (deviceId, packageName) => invoke('device:launch-package', { deviceId, packageName }),
    listFiles: (deviceId, path) => invoke('device:list-files', { deviceId, path }),
    push: (deviceId, localPath, remotePath) => invoke('device:push', { deviceId, localPath, remotePath }),
    pull: (deviceId, remotePath) => invoke('device:pull', { deviceId, remotePath }),
    pullBatch: (deviceId, remotePaths, targetDir) => invoke('device:pull-batch', { deviceId, remotePaths, targetDir }),
    thumbnail: (deviceId, remotePath) => invoke('device:thumbnail', { deviceId, remotePath }),
    shell: (deviceId, command) => invoke('device:shell', { deviceId, command })
  },
  control: {
    key: (deviceId, key) => invoke('control:key', { deviceId, key }),
    rotate: (deviceId, orientation) => invoke('control:rotate', { deviceId, orientation }),
    notifications: (deviceId, expand) => invoke('control:notifications', { deviceId, expand }),
    reboot: (deviceId) => invoke('control:reboot', deviceId),
    gnirehtetStart: (deviceId) => invoke('control:gnirehtet-start', deviceId),
    gnirehtetStop: () => invoke('control:gnirehtet-stop'),
    gnirehtetStatus: () => invoke('control:gnirehtet-status')
  },
  scrcpy: {
    start: (payload) => invoke('scrcpy:start', payload),
    stop: (sessionId) => invoke('scrcpy:stop', sessionId),
    stopAll: () => invoke('scrcpy:stop-all'),
    list: () => invoke('scrcpy:list'),
    onSessionEnded: subscribe('scrcpy:session-ended')
  },
  clipboard: {
    pasteToDevice: (sessionId) => invoke('clipboard:paste-to-device', sessionId),
    copyFromDevice: (cut) => invoke('clipboard:copy-from-device', cut)
  },
  input: {
    text: (text) => invoke('input:text', text),
    keycode: (code, meta) => invoke('input:keycode', { code, meta })
  },
  frame: {
    getPayload: () => invoke('frame:get-payload'),
    rendered: () => invoke('frame:rendered'),
    invalidate: () => invoke('frame:invalidate'),
    onUpdated: subscribe('frame:payload-updated'),
    models: () => invoke('frame:models'),
    mouseState: (state) => invoke('frame:mouse-state', state),
    dragStart: () => invoke('frame:drag-start'),
    dragEnd: () => invoke('frame:drag-end')
  },
  hos: {
    onFrame: subscribe('hos:frame'),
    input: (ev) => invoke('hos:input', ev),
    key: (name) => invoke('hos:key', name)
  },
  scrcpyFrame: subscribe('scrcpy:frame'),
  windowControl: (sessionId, action) => invoke('window:control', { sessionId, action }),
  controls: {
    getPayload: () => invoke('controls:get-payload')
  }
}

contextBridge.exposeInMainWorld('starcast', starcast)
