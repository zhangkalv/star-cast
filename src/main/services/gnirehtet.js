import { spawn } from 'child_process'
import { configStore } from '../config.js'
import { resolveBinary, toolsEnv } from './binary-locator.js'
import { logger } from '../logger.js'

let child = null

function gnirehtetBin() {
  return resolveBinary('gnirehtet', configStore.get().general.gnirehtetPath)
}

export function startGnirehtet(serial) {
  const bin = gnirehtetBin()
  if (!bin) return { ok: false, message: '未找到 gnirehtet，请在「设置 → 通用」中指定路径' }
  if (child) return { ok: false, message: '反向供网已在运行' }
  logger.info('[gnirehtet] 启动反向供网', serial)
  child = spawn(bin, ['run', serial], { windowsHide: true, env: toolsEnv() })
  child.on('exit', (code) => {
    logger.info('[gnirehtet] 退出', code)
    child = null
  })
  child.on('error', (err) => {
    logger.error('[gnirehtet] 启动失败', err.message)
    child = null
  })
  return { ok: true, message: '反向供网已启动' }
}

export function stopGnirehtet() {
  if (!child) return { ok: true, message: '未在运行' }
  child.kill()
  child = null
  return { ok: true, message: '反向供网已停止' }
}

export function gnirehtetRunning() {
  return !!child
}
