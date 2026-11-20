import { spawn } from 'child_process'
import net from 'net'
import { existsSync } from 'fs'
import { clipboard } from 'electron'
import { logger } from '../logger.js'
import { resourcePath } from './paths.js'
import { adbBin, adbRun, adbShell, adbPush, adbScreenSize, KEY_CODES } from './adb.js'


const SERVER_VERSION = '5.0.1'
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar'
const CTRL_MSG_INJECT_KEYCODE = 0
const CTRL_MSG_INJECT_TEXT = 1
const CTRL_MSG_GET_CLIPBOARD = 8
const CTRL_MSG_SET_CLIPBOARD = 9
const DEVICE_MSG_CLIPBOARD = 0
const CLIPBOARD_TEXT_MAX = 262130
let clipboardOwner = null

function serverBin() {
  const p = resourcePath('bin', process.platform, process.platform === 'win32' ? 'scrcpy-server' : 'scrcpy-server')
  if (existsSync(p)) return p
  return resourcePath('bin', process.platform, 'scrcpy-server')
}

function findStartCode(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) return i
      if (buf[i + 2] === 0 && buf[i + 3] === 1) return i
    }
  }
  return -1
}

function splitNals(annexB) {
  const sps = []
  const pps = []
  let hasVideoData = false
  const starts = []
  for (let i = 0; i < annexB.length - 3; i++) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) starts.push([i, i + 3])
    else if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 0 && annexB[i + 3] === 1) { starts.push([i, i + 4]); i++ }
  }
  for (let k = 0; k < starts.length; k++) {
    const nalStart = starts[k][1]
    if (nalStart >= annexB.length) continue
    const type = annexB[nalStart] & 0x1f
    const nalEnd = k + 1 < starts.length ? starts[k + 1][0] : annexB.length
    const nal = annexB.subarray(starts[k][0], nalEnd)
    if (type === 7) sps.push(nal)
    else if (type === 8) pps.push(nal)
    else if (type === 1 || type === 5 || type === 2) hasVideoData = true
  }
  return { sps: Buffer.concat(sps), pps: Buffer.concat(pps), hasVideoData }
}

export async function startScrcpyStream(deviceId, options = {}) {
  try {
    return await startStream(deviceId, options, true)
  } catch (e) {
    if (!e || e.code !== 'CONTROL_FAILED') throw e
    logger.warn('[scrcpy-stream] 控制通道不可用，回退为无剪贴板模式', e.message)
    return startStream(deviceId, options, false)
  }
}

async function startStream(deviceId, { onFrame, onFirstFrame, onError, maxSize = 0, videoBitRate = 8000000, maxFps = 0 } = {}, withControl) {
  const adb = adbBin()
  if (!adb) throw new Error('未找到 adb，请在「设置 → 通用」中指定路径')
  const srv = serverBin()
  if (!existsSync(srv)) throw new Error('缺少 scrcpy-server，无法启动一体投屏')

  const scid = Math.floor(Math.random() * 0x7fffffff) >>> 0
  const scidHex = scid.toString(16).padStart(8, '0')
  const socketName = `scrcpy_${scidHex}`
  let localPort = null
  let serverChild = null
  let client = null
  let controlSocket = null
  let clipboardTimer = null
  let clipboardToken = null
  let stopped = false
  let firstFrameFired = false
  let configAnnexB = Buffer.alloc(0)
  let configHeaderLogged = false

  const stop = () => {
    if (stopped) return
    stopped = true
    if (clipboardTimer) clearInterval(clipboardTimer)
    if (clipboardOwner === clipboardToken) clipboardOwner = null
    try { if (controlSocket) controlSocket.destroy() } catch {}
    try { if (client) client.destroy() } catch {}
    try { if (serverChild && !serverChild.killed) serverChild.kill() } catch {}
    if (savedScreenTimeout != null && /^\d+$/.test(savedScreenTimeout) && adb) {
      try { spawn(adb, ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'screen_off_timeout', savedScreenTimeout], { windowsHide: true }) } catch {}
    }
    if (localPort != null && adb) {
      try { spawn(adb, ['-s', deviceId, 'forward', '--remove', `tcp:${localPort}`], { windowsHide: true }) } catch {}
    }
  }

  const pushed = await adbPush(deviceId, srv, DEVICE_SERVER_PATH)
  if (!pushed.ok) throw new Error('推送 scrcpy-server 失败: ' + pushed.message)
  await adbShell(deviceId, `chmod 755 ${DEVICE_SERVER_PATH}`, { timeout: 10000 })

  const dims = await adbScreenSize(deviceId) || { width: 1080, height: 2406 }
  logger.info('[scrcpy-stream] 设备分辨率', deviceId, dims)

  localPort = await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port
      probe.close(() => resolve(p))
    })
  })
  const fwd = await adbRun(['-s', deviceId, 'forward', `tcp:${localPort}`, `localabstract:${socketName}`])
  if (fwd.code !== 0) throw new Error('adb forward 失败: ' + fwd.stderr.trim())

  const args = [
    '-s', deviceId, 'shell',
    `CLASSPATH=${DEVICE_SERVER_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server',
    SERVER_VERSION,
    `scid=${scidHex}`,
    'tunnel_forward=true',
    'video=true', 'audio=false', `control=${withControl ? 'true' : 'false'}`,
    ...(withControl ? ['clipboard_autosync=true'] : []),
    `max_size=${maxSize}`,
    `video_bit_rate=${videoBitRate}`,
    `max_fps=${maxFps}`
  ]

  let savedScreenTimeout = null
  try {
    const prev = await adbShell(deviceId, 'settings get system screen_off_timeout', { timeout: 10000 })
    savedScreenTimeout = (prev.stdout || '').trim()
  } catch {}
  try {
    await adbShell(deviceId, 'input keyevent 224', { timeout: 10000 }) // KEYCODE_WAKEUP
    await adbShell(deviceId, 'settings put system screen_off_timeout 2147483647', { timeout: 10000 })
  } catch {}
  logger.info('[scrcpy-stream] 启动 server', args.join(' '))
  serverChild = spawn(adb, args, { windowsHide: true })
  let serverErr = ''
  serverChild.stdout.on('data', (d) => {
    serverErr = (serverErr + d.toString()).slice(-2000)
    logger.debug('[scrcpy-stream:server]', d.toString().trim())
  })
  serverChild.stderr.on('data', (d) => {
    serverErr = (serverErr + d.toString()).slice(-2000)
    logger.debug('[scrcpy-stream:server]', d.toString().trim())
  })
  serverChild.on('error', (e) => logger.error('[scrcpy-stream] server 进程错误', e.message))
  serverChild.on('exit', (code) => {
    logger.info('[scrcpy-stream] server 退出', deviceId, code, serverErr.slice(-200))
    if (!stopped && onError) {
      const errLine = serverErr.split(/\r?\n/).map((l) => l.trim())
        .find((l) => /error|exception|abort|failed|fatal/i.test(l) && !/file pushed/i.test(l))
      onError(errLine ? `投屏服务退出: ${errLine}` : (code === 0 ? '投屏服务已正常结束' : `投屏服务退出 (code ${code})`))
    }
  })

  await new Promise((r) => setTimeout(r, 1200))
  const connectWithRetry = async () => {
    for (let i = 0; i < 40; i++) {
      if (stopped) throw new Error('已停止')
      try {
        return await new Promise((resolve, reject) => {
          const s = net.connect(localPort, '127.0.0.1')
          const t = setTimeout(() => { s.destroy(); reject(new Error('连接超时')) }, 1000)
          s.once('connect', () => { clearTimeout(t); resolve(s) })
          s.once('error', (e) => { clearTimeout(t); reject(e) })
        })
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('无法连接 scrcpy video socket')
  }

  client = await connectWithRetry()
  client.on('error', (e) => {
    if (!stopped) logger.warn('[scrcpy-stream] socket 错误', e.message)
  })

  let pasteFromClipboard = () => false
  let copyFromDevice = () => false
  let injectText = null
  let injectKeycode = null
  let injectScroll = null
  if (withControl) {
    let ctrlConnected = false
    for (let i = 0; i < 40 && !ctrlConnected; i++) {
      if (stopped) break
      try {
        controlSocket = await new Promise((resolve, reject) => {
          const s = net.connect(localPort, '127.0.0.1')
          const t = setTimeout(() => { s.destroy(); reject(new Error('连接超时')) }, 1000)
          s.once('connect', () => { clearTimeout(t); resolve(s) })
          s.once('error', (e) => { clearTimeout(t); reject(e) })
        })
        ctrlConnected = true
      } catch {
        controlSocket = null
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    if (!ctrlConnected) {
      stop()
      const err = new Error('无法连接 scrcpy 控制 socket')
      err.code = 'CONTROL_FAILED'
      throw err
    }
    controlSocket.on('error', (e) => {
      if (!stopped) logger.warn('[scrcpy-stream] 控制通道错误', e.message)
    })
    controlSocket.on('close', () => {
      if (clipboardTimer) clearInterval(clipboardTimer)
      if (clipboardOwner === clipboardToken) clipboardOwner = null
    })

    const sendControl = (buf) => {
      if (!controlSocket || controlSocket.destroyed || stopped) return false
      try { controlSocket.write(buf); return true } catch { return false }
    }
    injectText = (text) => {
      const body = Buffer.from(String(text || ''), 'utf8').subarray(0, 300)
      if (!body.length) return false
      const msg = Buffer.alloc(5 + body.length)
      msg[0] = CTRL_MSG_INJECT_TEXT
      msg.writeUInt32BE(body.length, 1)
      body.copy(msg, 5)
      return sendControl(msg)
    }

    injectKeycode = (code, meta = 0, repeat = 0) => {
      const keycode = Number(code)
      if (!Number.isFinite(keycode) || keycode < 0) return false
      for (const action of [0, 1]) {
        const msg = Buffer.alloc(14)
        msg[0] = CTRL_MSG_INJECT_KEYCODE
        msg[1] = action
        msg.writeUInt32BE(keycode, 2)
        msg.writeUInt32BE(repeat >>> 0, 6)
        msg.writeUInt32BE(meta >>> 0, 10)
        if (!sendControl(msg)) return false
      }
      return true
    }

    let lastSwipeAt = 0
    injectScroll = (ev) => {
      const now = Date.now()
      if (now - lastSwipeAt < 120) return true
      lastSwipeAt = now
      const x = Math.max(0, Math.min(dims.width - 1, Math.round((Number(ev.x) || 0) * dims.width)))
      const y = Math.max(0, Math.min(dims.height - 1, Math.round((Number(ev.y) || 0) * dims.height)))
      const raw = (Number(ev.deltaY) || 0) || (Number(ev.deltaX) || 0)
      const distance = Math.max(-600, Math.min(600, raw * 3)) || (raw >= 0 ? 300 : -300)
      const y1 = Math.max(0, Math.min(dims.height - 1, y - distance))
      adbShell(deviceId, `input swipe ${x} ${y} ${x} ${y1} 160`, { timeout: 5000 })
      return true
    }

    copyFromDevice = (cut = false) => sendControl(Buffer.from([CTRL_MSG_GET_CLIPBOARD, cut ? 2 : 1]))

    let seq = 0
    let lastClipboardText = ''
    try { lastClipboardText = clipboard.readText() || '' } catch {}
    clipboardToken = { deviceId }
    clipboardOwner = clipboardToken

    const sendSetClipboard = (text, paste) => {
      if (!controlSocket || controlSocket.destroyed || stopped) return false
      const body = Buffer.from(text || '', 'utf8')
      if (!body.length || body.length > CLIPBOARD_TEXT_MAX) return false
      seq = (seq + 1) >>> 0
      const msg = Buffer.alloc(14 + body.length)
      msg[0] = CTRL_MSG_SET_CLIPBOARD
      msg.writeBigUInt64BE(BigInt(seq), 1)
      msg[9] = paste ? 1 : 0
      msg.writeUInt32BE(body.length, 10)
      body.copy(msg, 14)
      try { controlSocket.write(msg); return true } catch { return false }
    }

    let ctrlBuf = Buffer.alloc(0)
    controlSocket.on('data', (d) => {
      ctrlBuf = Buffer.concat([ctrlBuf, d])
      if (ctrlBuf.length > 1024 * 1024) ctrlBuf = Buffer.alloc(0)
      while (ctrlBuf.length >= 1) {
        const type = ctrlBuf[0]
        let msgLen
        if (type === 1) {
          msgLen = 9 // ACK_CLIPBOARD: type + 8 字节 sequence，无 length 字段
        } else if (type === 2) {
          if (ctrlBuf.length < 5) break
          msgLen = 5 + ctrlBuf.readUInt16BE(3)
        } else {
          if (ctrlBuf.length < 5) break
          const len = ctrlBuf.readUInt32BE(1)
          if (len > 262144) { ctrlBuf = Buffer.alloc(0); break }
          msgLen = 5 + len
        }
        if (ctrlBuf.length < msgLen) break
        const payload = type === 1 ? Buffer.alloc(0) : ctrlBuf.subarray(5, msgLen)
        ctrlBuf = ctrlBuf.subarray(msgLen)
        logger.debug('[scrcpy-stream] 控制消息', deviceId, 'type', type, 'len', msgLen - 5)
        if (type !== DEVICE_MSG_CLIPBOARD || !payload.length) continue
        const text = payload.toString('utf8')
        if (text === lastClipboardText) continue
        lastClipboardText = text
        if (clipboardOwner === clipboardToken) {
          try {
            clipboard.writeText(text)
            logger.debug('[scrcpy-stream] 手机剪贴板 → 电脑', text.slice(0, 80))
          } catch {}
        }
      }
    })

    clipboardTimer = setInterval(() => {
      if (stopped || clipboardOwner !== clipboardToken) return
      let text = ''
      try { text = clipboard.readText() || '' } catch { return }
      if (!text || text === lastClipboardText) return
      lastClipboardText = text
      if (sendSetClipboard(text, false)) logger.debug('[scrcpy-stream] 电脑剪贴板 → 手机', text.slice(0, 80))
    }, 800)

    pasteFromClipboard = () => {
      let text = ''
      try { text = clipboard.readText() || '' } catch { return false }
      if (!text) return false
      lastClipboardText = text
      return sendSetClipboard(text, true)
    }
  }

  let buf = Buffer.alloc(0)
  let headerDone = false

  const processStream = () => {
    while (true) {
      if (!headerDone) {
        if (buf.length < 81) return
        const codecId = buf.subarray(65, 69).toString('ascii')
        const sessionW = buf.readUInt32BE(73)
        const sessionH = buf.readUInt32BE(77)
        buf = buf.subarray(81)
        headerDone = true
        logger.info('[scrcpy-stream] 视频头已读取', deviceId, 'codec', codecId, 'session', sessionW + 'x' + sessionH)
      }
      if (buf.length < 12) return
      const flags = buf.readBigUInt64BE(0)
      const second = buf.readUInt32BE(8)
      if ((flags & 0x8000000000000000n) !== 0n) {
        logger.info('[scrcpy-stream] session 包', deviceId, Number(flags & 0xffffffffn) + 'x' + second)
        buf = buf.subarray(12)
        continue
      }
      const size = second
      if (size > 64 * 1024 * 1024) { buf = Buffer.alloc(0); return }
      if (buf.length < 12 + size) return
      const payload = Buffer.from(buf.subarray(12, 12 + size))
      buf = buf.subarray(12 + size)

      const isConfig = (flags & 0x4000000000000000n) !== 0n
      const isKey = (flags & 0x2000000000000000n) !== 0n

      if (isConfig) {
        const { sps, pps } = splitNals(payload)
        if (sps.length || pps.length) {
          configAnnexB = Buffer.concat([sps, pps])
          if (!configHeaderLogged) {
            configHeaderLogged = true
            logger.info('[scrcpy-stream] 已缓存 SPS/PPS', deviceId, 'sps', sps.length, 'pps', pps.length)
          }
        }
        continue
      }

      const { sps } = splitNals(payload)
      const frame = (!sps.length && configAnnexB.length) ? Buffer.concat([configAnnexB, payload]) : payload
      if (stopped) continue
      if (!firstFrameFired) {
        firstFrameFired = true
        try { onFirstFrame && onFirstFrame() } catch {}
      }
      if (onFrame) onFrame(frame, { key: isKey })
    }
  }

  client.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    try { processStream() } catch (e) {
      logger.error('[scrcpy-stream] 解析异常', e.message)
    }
  })
  client.on('close', () => {
    if (!stopped && onError) onError('视频连接已断开')
  })

  const input = (ev) => {
    if (stopped) return
    if (ev.type === 'tap') {
      const x = Math.round(ev.x * dims.width)
      const y = Math.round(ev.y * dims.height)
      adbShell(deviceId, `input tap ${x} ${y}`, { timeout: 5000 })
    } else if (ev.type === 'swipe') {
      const x1 = Math.round(ev.x1 * dims.width), y1 = Math.round(ev.y1 * dims.height)
      const x2 = Math.round(ev.x2 * dims.width), y2 = Math.round(ev.y2 * dims.height)
      adbShell(deviceId, `input swipe ${x1} ${y1} ${x2} ${y2} ${ev.ms || 300}`, { timeout: 5000 })
    } else if (ev.type === 'scroll') {
      if (injectScroll) {
        injectScroll(ev)
      } else {
        const x = Math.round((Number(ev.x) || 0) * dims.width)
        const y = Math.round((Number(ev.y) || 0) * dims.height)
        const dy = (Number(ev.deltaY) || 0) > 0 ? -180 : 180
        const y2 = Math.max(0, Math.min(dims.height, y + dy))
        adbShell(deviceId, `input swipe ${x} ${y} ${x} ${y2} 200`, { timeout: 5000 })
      }
    }
  }
  const key = (name) => {
    const code = KEY_CODES[name] ?? (Number.isInteger(Number(name)) ? Number(name) : null)
    if (code != null && injectKeycode) return Promise.resolve(injectKeycode(code))
    return adbShell(deviceId, `input keyevent ${name}`, { timeout: 5000 })
  }
  const inputText = (text) => injectText ? Promise.resolve(injectText(text)) : Promise.resolve(false)
  const inputKeycode = (code, meta = 0) => injectKeycode
    ? Promise.resolve(injectKeycode(code, meta))
    : adbShell(deviceId, `input keyevent ${code}`, { timeout: 5000 })
  const rotate = (orientation) => {
    if (orientation === 'auto') return adbShell(deviceId, 'settings put system accelerometer_rotation 1')
    return adbShell(deviceId, `settings put system accelerometer_rotation 0; input keyevent ${orientation === 'landscape' ? 188 : 189}`)
  }

  return { dims, stop, input, key, rotate, pasteFromClipboard, copyFromDevice, inputText, inputKeycode }
}
