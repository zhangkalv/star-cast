import { execFileSync, spawn } from 'child_process'
import { resourcePath } from './paths.js'
import { logger } from '../logger.js'

function helperExe() {
  return resourcePath('bin', process.platform, 'star-window-helper.exe')
}

/** 通过 star-window-helper.exe 控制 scrcpy 原生窗口（无边框模式没有原生标题栏按钮） */
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

/** 查询窗口位置/最小化/置顶状态（物理像素） */
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

/** 发送 WM_CLOSE（让 scrcpy 优雅退出、正常收尾录制文件） */
export function sendWindowClose(title) {
  return runHelper(['close', title])
}

export function moveWindow(title, x, y) {
  return runHelper(['move', title, String(Math.round(x)), String(Math.round(y))])
}

/** 隐藏窗口（首帧就绪前不显示，消除启动黑屏闪烁） */
export function hideWindow(title) {
  return runHelper(['hide', title])
}

/** 显示窗口（SW_SHOW，保证前置可见） */
export function showWindow(title) {
  return runHelper(['show', title])
}

/**
 * 等待鼠标左键释放（Windows 层 GetAsyncKeyState，不依赖渲染层 mouseup）。
 * 用于拖动循环：鼠标移出窗口时渲染层收不到 mouseup，靠此可靠停住。
 * @returns {{kill:()=>void}}
 */
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

/**
 * 窗口圆角：禁用 DWM 系统圆角 + SetWindowRgn 圆角裁剪（消除四角露底）。
 * 传 radiusY 时做椭圆裁剪，精确匹配机型边框的外圈椭圆弧。
 */
export function setWindowCorners(title, radius, radiusY) {
  const args = ['corners', title, String(Math.round(radius))]
  if (radiusY != null) args.push(String(Math.round(radiusY)))
  return runHelper(args)
}

/** 启动拖动循环：窗口跟随光标移动，松开左键自动结束（物理像素坐标） */
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
