import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

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

export function preloadPath() {
  const dir = join(app.getAppPath(), 'out', 'preload')
  for (const name of ['index.js', 'index.mjs']) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return join(dir, 'index.js')
}
