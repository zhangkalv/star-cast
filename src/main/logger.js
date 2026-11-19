import { app } from 'electron'
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

let logFile = null

function ensureFile() {
  if (!logFile) {
    const dir = join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
  }
  return logFile
}

function format(level, args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  return `[${new Date().toLocaleString('zh-CN', { hour12: false })}] [${level}] ${text}`
}

function write(level, args) {
  const line = format(level, args)
  try {
    appendFileSync(ensureFile(), line + '\n')
  } catch (e) {
    console.error('[logger] 写入日志失败', e)
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
  debug: (...args) => write('debug', args)
}
