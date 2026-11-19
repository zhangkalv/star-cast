import { app } from 'electron'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  copyFileSync,
  mkdirSync,
  rmSync
} from 'fs'
import { join, dirname } from 'path'
import { logger } from './logger.js'

export const defaultConfig = {
  general: {
    theme: 'system',
    language: 'zh-CN',
    storagePath: '',
    adbPath: '',
    scrcpyPath: '',
    gnirehtetPath: '',
    hdcPath: '',
    scrcpyExtraArgs: '',
    autoConnect: true,
    autoMirror: false,
    floatingControlBar: false,
    debug: false
  },
  video: {
    enabled: true,
    maxSize: 1920,
    bitRate: '8M',
    fps: 60,
    codec: 'h264',
    orientation: '0',
    crop: '',
    displayId: '',
    bufferMs: 0,
    v4l2BufferMs: 0
  },
  audio: {
    enabled: true,
    source: 'output',
    codec: 'opus',
    bitRate: '128k',
    bufferMs: 50,
    outputBufferMs: 0
  },
  window: {
    width: 420,
    height: 900,
    x: -1,
    y: -1,
    borderless: true,
    fullscreen: false,
    alwaysOnTop: false,
    disableScreensaver: true
  },
  device: {
    showTouches: true,
    stayAwake: true,
    powerOffOnClose: false
  },
  input: {
    mouseMode: 'sdk',
    mouseBind: 'bhsn',
    keyboardMode: 'sdk',
    gamepad: 'disabled'
  },
  record: {
    format: 'mp4',
    orientation: '0',
    durationSec: 0,
    noPlayback: false,
    noAudioPlayback: false
  },
  camera: {
    size: '',
    facing: 'front',
    fps: 30
  },
  frame: {
    enabled: true,
    model: 'galaxy-s24',
    opacity: 1
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(target, patch) {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

function configFile() {
  return join(app.getPath('userData'), 'config.json')
}

function load() {
  const file = configFile()
  if (!existsSync(file)) return structuredClone(defaultConfig)
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return deepMerge(structuredClone(defaultConfig), raw)
  } catch (e) {
    logger.error('[config] 解析 config.json 失败，使用默认配置', e.message)
    try {
      copyFileSync(file, file + '.broken.bak')
    } catch {}
    return structuredClone(defaultConfig)
  }
}

function save(data) {
  const file = configFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    copyFileSync(tmp, file)
    try {
      rmSync(tmp)
    } catch {}
  }
}

let cache = null

export const configStore = {
  get() {
    if (!cache) cache = load()
    return cache
  },
  set(patch) {
    cache = deepMerge(this.get(), patch)
    save(cache)
    return cache
  },
  replace(next) {
    cache = deepMerge(structuredClone(defaultConfig), next)
    save(cache)
    return cache
  },
  reset() {
    cache = structuredClone(defaultConfig)
    save(cache)
    return cache
  }
}
