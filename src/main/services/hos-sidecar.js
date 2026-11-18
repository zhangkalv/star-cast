import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import net from 'net'
import crypto from 'crypto'
import { app } from 'electron'
import { logger } from '../logger.js'
import { resourcePath } from './paths.js'
import { resolveBinary } from './binary-locator.js'

/**
 * 鸿蒙投屏：hosScrcpy 1.0.18 SDK sidecar 桥接。
 *
 * 链路：主进程 spawn 一个 Java 进程（jar+class 随包发布），sidecar 内部用
 * 华为 HOScrcpy SDK 连设备并出 H.264 流，经本机 WebSocket 推二进制帧；
 * 本模块用极简 WS 客户端收帧，回调给渲染层用 WebCodecs 解码。
 * 触控/按键经同一 WS 以 JSON 命令回传 sidecar 注入设备。
 *
 * 这是替代旧「截屏流 + 手写 gRPC」的新方案，真机实测（HarmonyOS 7.0.0.111 /
 * JUY-AL80）可正常出帧，规避了旧 so 6.9 与 7.x 不兼容导致的 surface failed。
 */

function javaBin() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  // JAVA_HOME 可能指向 JDK 根目录或 bin 目录，两种都兼容
  if (process.env.JAVA_HOME) {
    const direct = join(process.env.JAVA_HOME, 'bin', exe)
    if (existsSync(direct)) return direct
    const nested = join(process.env.JAVA_HOME, 'bin', 'bin', exe)
    if (existsSync(nested)) return nested
    if (existsSync(join(process.env.JAVA_HOME, exe))) return join(process.env.JAVA_HOME, exe)
  }
  // 交给 spawn 从 PATH 解析
  return exe
}

function sidecarClasspath() {
  const jar = resourcePath('hos', 'hosScrcpy-1.0.18-beta.jar')
  const outDir = resourcePath('hos', 'out')
  const sep = process.platform === 'win32' ? ';' : ':'
  return [jar, outDir].join(sep)
}

/** 极简 WebSocket 客户端（仅本场景所需：文本命令 + 二进制帧，无分片/扩展） */
class WsClient {
  constructor(port, { onFrame, onText, onOpen, onClose }) {
    this.port = port
    this.onFrame = onFrame
    this.onText = onText
    this.onOpen = onOpen
    this.onClose = onClose
    this.sock = null
    this.buf = Buffer.alloc(0)
    this.handshaked = false
    this.closed = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64')
      const sock = net.connect(this.port, '127.0.0.1', () => {
        sock.write(
          `GET / HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${this.port}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`
        )
      })
      this.sock = sock
      const timer = setTimeout(() => reject(new Error('WebSocket 握手超时')), 10000)
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d])
        if (!this.handshaked) {
          const i = this.buf.indexOf('\r\n\r\n')
          if (i < 0) return
          const head = this.buf.subarray(0, i).toString('utf8')
          if (!/101/.test(head)) {
            clearTimeout(timer)
            reject(new Error('WebSocket 握手失败: ' + head.slice(0, 80)))
            sock.destroy()
            return
          }
          this.handshaked = true
          this.buf = this.buf.subarray(i + 4)
          clearTimeout(timer)
          resolve()
          try { this.onOpen && this.onOpen() } catch {}
        }
        this._drain()
      })
      sock.on('error', (e) => {
        clearTimeout(timer)
        if (!this.closed) {
          logger.warn('[hos-sidecar] WS 错误', e.message)
          try { this.onClose && this.onClose() } catch {}
        }
      })
      sock.on('close', () => {
        if (!this.closed) {
          try { this.onClose && this.onClose() } catch {}
        }
      })
    })
  }

  _drain() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0]
      const b1 = this.buf[1]
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) break
        len = this.buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) break
        len = Number(this.buf.readBigUInt64BE(2))
        off = 10
      }
      if (this.buf.length < off + len) break
      const payload = Buffer.from(this.buf.subarray(off, off + len))
      const op = b0 & 0x0f
      this.buf = this.buf.subarray(off + len)
      if (op === 0x2) {
        try { this.onFrame && this.onFrame(payload) } catch {}
      } else if (op === 0x1) {
        try { this.onText && this.onText(payload.toString('utf8')) } catch {}
      }
    }
  }

  sendText(str) {
    if (!this.sock || this.closed || !this.handshaked) return
    const p = Buffer.from(str, 'utf8')
    const mask = crypto.randomBytes(4)
    let head
    if (p.length < 126) {
      head = Buffer.from([0x81, 0x80 | p.length])
    } else if (p.length < 65536) {
      head = Buffer.alloc(4)
      head[0] = 0x81
      head[1] = 0x80 | 126
      head.writeUInt16BE(p.length, 2)
    } else {
      head = Buffer.alloc(10)
      head[0] = 0x81
      head[1] = 0x80 | 127
      head.writeBigUInt64BE(BigInt(p.length), 2)
    }
    const masked = Buffer.alloc(p.length)
    for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4]
    try { this.sock.write(Buffer.concat([head, mask, masked])) } catch {}
  }

  close() {
    this.closed = true
    if (this.sock) {
      try { this.sock.destroy() } catch {}
      this.sock = null
    }
  }
}

/**
 * 启动一路鸿蒙投屏 sidecar。连接建立后先取设备分辨率，resolve 时返回 dims；
 * 默认自动开流，传 autoStart:false 可先建窗口再手动 screen('video')。
 * @returns {Promise<{dims, stop, input, key, screen, setBroadcast}>}
 */
export async function startHosSidecar(deviceId, { onFrame, onFirstFrame, onMessage, onError, autoStart = true, sizeTimeout = 12000 } = {}) {
  const jar = resourcePath('hos', 'hosScrcpy-1.0.18-beta.jar')
  const outDir = resourcePath('hos', 'out')
  if (!existsSync(jar) || !existsSync(outDir)) {
    throw new Error('缺少 hosScrcpy SDK（resources/hos），无法投屏')
  }

  const java = javaBin()
  const hdc = resolveBinary('hdc', '')
  if (!hdc) throw new Error('未找到 hdc，请在「设置 → 通用」中指定路径')

  const cp = sidecarClasspath()
  const args = [
    '-cp', cp,
    'Main',
    '--sn', deviceId,
    '--hdc', hdc,
    '--port', '0',
    '--scale', '2',
    '--frame-rate', '30',
    '--idle-exit', '0'
  ]
  logger.info('[hos-sidecar] 启动', { deviceId, java, args: args.join(' ') })

  const child = spawn(java, args, { windowsHide: true })

  let settled = false
  let ws = null
  let stopped = false
  let firstFrameFired = false
  let stdoutTail = ''
  let stderrTail = ''

  let resolveSize = null
  const sizePromise = new Promise((resolve) => { resolveSize = resolve })
  const feedSize = (data) => {
    if (!data || typeof data !== 'string') return
    const m = /^(\d+)\s*x\s*(\d+)$/.exec(data.trim())
    if (m && resolveSize) {
      const dims = { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
      logger.info('[hos-sidecar] 设备分辨率', deviceId, dims)
      resolveSize(dims)
      resolveSize = null
    }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (ws) ws.close()
    if (child && !child.killed) {
      try { child.kill() } catch {}
    }
  }

  const readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('sidecar 启动超时: ' + (stderrTail || stdoutTail).slice(-200)))
    }, 20000)

    child.stdout.on('data', (d) => {
      const text = d.toString()
      stdoutTail = (stdoutTail + text).slice(-4000)
      logger.debug('[hos-sidecar:out]', text.trim())
      if (!settled) {
        const m = /\{"ready":true,"port":(\d+)/.exec(stdoutTail)
        if (m) {
          settled = true
          clearTimeout(timer)
          resolve(parseInt(m[1], 10))
        }
      }
      // 透传业务消息（stream ready / size / 错误等）
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('{')) continue
        try {
          const o = JSON.parse(line)
          if (o.msg === 'size' && o.data) feedSize(o.data)
          if (onMessage) onMessage(o)
        } catch {}
      }
    })

    child.stderr.on('data', (d) => {
      const text = d.toString()
      stderrTail = (stderrTail + text).slice(-4000)
      logger.debug('[hos-sidecar:err]', text.trim())
    })

    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('无法启动 Java sidecar（请确认已安装 Java 8+ 并配置 JAVA_HOME）: ' + e.message))
      }
    })

    child.on('exit', (code) => {
      logger.info('[hos-sidecar] 进程退出', deviceId, code)
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('sidecar 提前退出: ' + (stderrTail || `code ${code}`).slice(-200)))
      }
      if (ws) ws.close()
      if (!stopped && onError) onError('投屏服务意外退出')
    })
  })

  try {
    const port = await readyPromise
    ws = new WsClient(port, {
      onFrame: (buf) => {
        if (stopped) return
        if (!firstFrameFired) {
          firstFrameFired = true
          try { onFirstFrame && onFirstFrame() } catch {}
        }
        if (onFrame) onFrame(buf)
      },
      onText: (txt) => {
        try {
          const o = JSON.parse(txt)
          if (o.msg === 'size' && o.data) feedSize(o.data)
          if (onMessage) onMessage(o)
        } catch {}
      },
      onClose: () => {
        if (!stopped && onError) onError('视频连接已断开')
      }
    })
    await ws.connect()
    // 先取分辨率（sidecar 用 SDK getScreenSize，最准），等待返回
    ws.sendText(JSON.stringify({ type: 'size' }))
    const dims = await Promise.race([
      sizePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('获取设备分辨率超时')), sizeTimeout))
    ])
    if (autoStart) ws.sendText(JSON.stringify({ type: 'screen', mode: 'video' }))

    return {
      dims,
      stop,
      input: (ev) => {
        if (ev.type === 'tap') {
          ws.sendText(JSON.stringify({ type: 'touch', event: 'down', x: Math.round(ev.x), y: Math.round(ev.y) }))
          // 轻点：稍后抬起（坐标是归一化，由渲染层换算成物理像素后传入）
          setTimeout(() => ws.sendText(JSON.stringify({ type: 'touch', event: 'up', x: Math.round(ev.x), y: Math.round(ev.y) })), 60)
        } else if (ev.type === 'swipe') {
          ws.sendText(JSON.stringify({ type: 'touch', event: 'down', x: Math.round(ev.x1), y: Math.round(ev.y1) }))
          const steps = 8
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            setTimeout(() => {
              ws.sendText(JSON.stringify({
                type: 'touch',
                event: 'move',
                x: Math.round(ev.x1 + (ev.x2 - ev.x1) * t),
                y: Math.round(ev.y1 + (ev.y2 - ev.y1) * t)
              }))
            }, Math.max(10, Math.round((ev.ms || 200) * t)))
          }
          setTimeout(() => ws.sendText(JSON.stringify({ type: 'touch', event: 'up', x: Math.round(ev.x2), y: Math.round(ev.y2) })), Math.max(20, ev.ms || 200) + 20)
        }
      },
      key: (name) => ws.sendText(JSON.stringify({ type: 'key', name })),
      screen: (mode) => ws.sendText(JSON.stringify({ type: 'screen', mode })),
      setBroadcast: (on) => ws.sendText(JSON.stringify({ type: 'screen', mode: on ? 'resume' : 'pause' }))
    }
  } catch (e) {
    stop()
    throw e
  }
}
