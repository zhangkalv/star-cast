import { execFileSync, spawn } from 'child_process'
import { resourcePath } from './paths.js'
import { logger } from '../logger.js'

function helperExe() {
  return resourcePath('bin', process.platform, 'star-window-helper.exe')
}

function runHelper(args) {
  try {
    const out = execFileSync(helperExe(), args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return JSON.parse(out.trim())
  } catch (e) {
    logger.debug('[win32] helper 调用失败', args[0], e.message)
    return { ok: false }
  }
}

export function queryWindow(title) {
  return runHelper(['query', title])
}

export function minimizeWindow(title) {
  return runHelper(['minimize', title])
}

export function restoreWindow(title) {
  return runHelper(['restore', title])
}

export function setWindowTopmost(title, on) {
  return runHelper(['topmost', title, on ? 'on' : 'off'])
}

export function sendWindowClose(title) {
  return runHelper(['close', title])
}

export function moveWindow(title, x, y) {
  return runHelper(['move', title, String(Math.round(x)), String(Math.round(y))])
}

export function hideWindow(title) {
  return runHelper(['hide', title])
}

export function showWindow(title) {
  return runHelper(['show', title])
}

export function waitMouseRelease(onRelease) {
  let finished = false
  const child = spawn(helperExe(), ['waitrelease'], { windowsHide: true })
  const finish = () => {
    if (finished) return
    finished = true
    if (onRelease) onRelease()
  }
  child.on('exit', finish)
  child.on('error', (e) => {
    logger.debug('[win32] waitrelease 错误', e.message)
    finish()
  })
  return {
    kill() {
      try { child.kill() } catch {}
    }
  }
}

export function setWindowCorners(title, radius, radiusY) {
  const args = ['corners', title, String(Math.round(radius))]
  if (radiusY != null) args.push(String(Math.round(radiusY)))
  return runHelper(args)
}

export function startDragLoop(title, offX, offY, onExit) {
  const child = spawn(
    helperExe(),
    ['dragloop', title, String(Math.round(offX)), String(Math.round(offY))],
    { windowsHide: true }
  )
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    if (onExit) onExit()
  }
  child.on('exit', finish)
  child.on('error', (e) => {
    logger.debug('[win32] dragloop 错误', e.message)
    finish()
  })
  return {
    kill() {
      try {
        child.kill()
      } catch {}
    }
  }
}
