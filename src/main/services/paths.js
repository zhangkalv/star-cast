import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * 解析资源路径：打包后取 process.resourcesPath（extraResources 解包目录），
 * 开发态取 <app>/resources。
 */
export function resourcePath(...segments) {
  const candidates = [
    join(process.resourcesPath || '', ...segments),
    join(app.getAppPath(), 'resources', ...segments)
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return candidates[candidates.length - 1]
}

/** preload 产物路径：兼容 CJS(index.js) 与 ESM(index.mjs) 构建产物，防止 preload 静默加载失败 */
export function preloadPath() {
  const dir = join(app.getAppPath(), 'out', 'preload')
  for (const name of ['index.js', 'index.mjs']) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return join(dir, 'index.js')
}
