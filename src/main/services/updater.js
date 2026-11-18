import { app, shell } from 'electron'
import { logger } from '../logger.js'

// 更新检查接口。与「星点录屏」共用 fingertip-auth 服务，通过独立 channel 区分。
// 外网路径 /fingertip/ 为 nginx 前缀，对应服务内 /api/fingertip/update/check。
const UPDATE_API = 'https://api.siyushiji.com/fingertip/api/fingertip/update/check'
const CHANNEL = 'cast-stable'

/**
 * 检查更新。网络失败或无新版本时静默返回 hasUpdate:false。
 * version 比较按点分数字逐段比较，兼容 0.1.01 这类格式。
 */
export async function checkUpdate() {
  const current = app.getVersion()
  try {
    const res = await fetch(`${UPDATE_API}?version=${encodeURIComponent(current)}&channel=${CHANNEL}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': `StarCast/${current}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const data = json.data || json
    const latest = String(data.version || '').trim()
    const hasUpdate = !!latest && compareVersion(latest, current) > 0
    return {
      ok: true,
      hasUpdate,
      current,
      version: latest,
      notes: data.notes || data.message || '',
      packageUrl: data.packageUrl || data.url || '',
      force: !!data.force
    }
  } catch (e) {
    logger.warn('[updater] 检查更新失败', e.message)
    return { ok: false, hasUpdate: false, current, message: e.message }
  }
}

function compareVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export async function openDownload(url) {
  if (url) await shell.openExternal(url)
}
