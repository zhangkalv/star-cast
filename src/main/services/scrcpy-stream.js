import { spawn } from 'child_process'
import net from 'net'
import { existsSync } from 'fs'
import { logger } from '../logger.js'
import { resourcePath } from './paths.js'
import { adbBin, adbRun, adbShell, adbPush, adbScreenSize } from './adb.js'

/**
 * Android 投屏：直接使用 scrcpy-server 的裸 H.264 流，画进一体边框窗口（WebCodecs 解码）。
 *
 * 与旧「scrcpy 独立原生窗口 + 边框覆盖窗口」方案不同：这里不让 scrcpy.exe 开窗口，
 * 而是自己启动 scrcpy-server，经 adb forward 读它的视频 socket，解析出 Annex-B
 * H.264 帧交给渲染层。这样画面与边框在**同一个 Electron 窗口**，根治错位/锯齿/闪烁。
 *
 * scrcpy 5.x 视频协议（server -> client）：
 *   video socket: [1B dummy][64B device name][4B codec id]
 *   每帧: [8B ptsAndFlags(bit63=config,bit62=keyframe)][4B size][payload]
 *   payload 为 AVCC（4 字节长度前缀 NALU）；config 包含 SPS/PPS。
 */

const SERVER_VERSION = '5.0.1'
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar'

function serverBin() {
  const p = resourcePath('bin', process.platform, process.platform === 'win32' ? 'scrcpy-server' : 'scrcpy-server')
  if (existsSync(p)) return p
  return resourcePath('bin', process.platform, 'scrcpy-server')
}

/** 找到第一个 Annex-B start code（00 00 01 或 00 00 00 01）的位置 */
function findStartCode(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) return i
      if (buf[i + 2] === 0 && buf[i + 3] === 1) return i
    }
  }
  return -1
}

/** 拆分 Annex-B 里的 NAL，返回 SPS/PPS 与是否含有视频帧数据 */
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

/**
 * 启动 scrcpy 裸流会话。
 * @returns {Promise<{dims, stop, input, key, rotate}>}
 */
export async function startScrcpyStream(deviceId, { onFrame, onFirstFrame, onError, maxSize = 0, videoBitRate = 8000000, maxFps = 0 } = {}) {
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
  let stopped = false
  let firstFrameFired = false
  let configAnnexB = Buffer.alloc(0)
  let configHeaderLogged = false

  const stop = () => {
    if (stopped) return
    stopped = true
    try { if (client) client.destroy() } catch {}
    try { if (serverChild && !serverChild.killed) serverChild.kill() } catch {}
    if (savedScreenTimeout != null && /^\d+$/.test(savedScreenTimeout) && adb) {
      try { spawn(adb, ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'screen_off_timeout', savedScreenTimeout], { windowsHide: true }) } catch {}
    }
    if (localPort != null && adb) {
      try { spawn(adb, ['-s', deviceId, 'forward', '--remove', `tcp:${localPort}`], { windowsHide: true }) } catch {}
    }
  }

  // 1) 推 server 到设备
  const pushed = await adbPush(deviceId, srv, DEVICE_SERVER_PATH)
  if (!pushed.ok) throw new Error('推送 scrcpy-server 失败: ' + pushed.message)
  await adbShell(deviceId, `chmod 755 ${DEVICE_SERVER_PATH}`, { timeout: 10000 })

  const dims = await adbScreenSize(deviceId) || { width: 1080, height: 2406 }
  logger.info('[scrcpy-stream] 设备分辨率', deviceId, dims)

  // 2) 找一个本地空闲端口并 adb forward
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

  // 3) 启动 server
  const args = [
    '-s', deviceId, 'shell',
    `CLASSPATH=${DEVICE_SERVER_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server',
    SERVER_VERSION,
    `scid=${scidHex}`,
    'tunnel_forward=true',
    'video=true', 'audio=false', 'control=false',
    `max_size=${maxSize}`,
    `video_bit_rate=${videoBitRate}`,
    `max_fps=${maxFps}`
  ]

  // 投屏期间保持设备亮屏并记下原屏幕超时，停止时恢复。
  // 否则设备自动熄屏后 DisplayManager 抓到黑帧，表现为画面全黑、触摸后才恢复。
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
      // server stdout 里常混有 "1 file pushed, xxx MB/s" 等无害进度信息，
      // 只提取真正的错误行；没有就用通用提示，避免把这些噪音当成错误弹给用户
      const errLine = serverErr.split(/\r?\n/).map((l) => l.trim())
        .find((l) => /error|exception|abort|failed|fatal/i.test(l) && !/file pushed/i.test(l))
      onError(errLine ? `投屏服务退出: ${errLine}` : (code === 0 ? '投屏服务已正常结束' : `投屏服务退出 (code ${code})`))
    }
  })

  // 4) 连接 video socket 并解析
  // 等待 server 完成 LocalServerSocket 绑定（adb forward 的 TCP 会立即连上，
  // 但此时设备端 abstract socket 还没就绪，会导致连接空转后断开）
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

  // 解析流：dummy(1) + deviceName(64) + codecId(4) + 帧头
  let buf = Buffer.alloc(0)
  let headerDone = false

  const processStream = () => {
    while (true) {
      if (!headerDone) {
        // scrcpy 5.x: dummy(1) + deviceName(64) + codecId(4) + sessionHeader(12)
        if (buf.length < 81) return
        const codecId = buf.subarray(65, 69).toString('ascii')
        const sessionW = buf.readUInt32BE(73)
        const sessionH = buf.readUInt32BE(77)
        buf = buf.subarray(81)
        headerDone = true
        logger.info('[scrcpy-stream] 视频头已读取', deviceId, 'codec', codecId, 'session', sessionW + 'x' + sessionH)
      }
      if (buf.length < 12) return
      // Java ByteBuffer 大端序。bit63=1 表示这是 session 包（后 8 字节是宽高，不是 size）
      const flags = buf.readBigUInt64BE(0)
      const second = buf.readUInt32BE(8)
      if ((flags & 0x8000000000000000n) !== 0n) {
        // 新的编码器会话（旋转/分辨率变化），后跟 width/height；跳过即可
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

      // config 包：payload 是 Annex-B SPS/PPS，缓存供后续无参数集的帧使用
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

      // 媒体包：payload 是 Annex-B access unit。若本包无 SPS/PPS，前置拼上缓存的
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

  // 触控：用 adb input（归一化 0~1 -> 物理像素）
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
    }
  }
  const key = (name) => adbShell(deviceId, `input keyevent ${name}`, { timeout: 5000 })
  const rotate = (orientation) => {
    if (orientation === 'auto') return adbShell(deviceId, 'settings put system accelerometer_rotation 1')
    return adbShell(deviceId, `settings put system accelerometer_rotation 0; input keyevent ${orientation === 'landscape' ? 188 : 189}`)
  }

  return { dims, stop, input, key, rotate }
}
