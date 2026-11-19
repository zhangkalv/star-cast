import { listAdbDevices, adbShell } from './adb.js'
import { listHdcDevices } from './hdc.js'
import { logger } from '../logger.js'

let nameCache = new Map()

async function enrichAndroidName(device) {
  if (device.model && device.model !== device.serial) {
    device.name = device.model
    return
  }
  if (nameCache.has(device.serial)) {
    device.name = nameCache.get(device.serial)
    return
  }
  const res = await adbShell(device.serial, 'getprop ro.product.marketname')
  const market = (res.stdout || '').trim()
  const fallback = await adbShell(device.serial, 'getprop ro.product.model')
  const name = market || (fallback.stdout || '').trim() || device.serial
  nameCache.set(device.serial, name)
  device.name = name
  device.model = device.model || name
}

export async function listAllDevices() {
  const [android, harmony] = await Promise.all([
    listAdbDevices().catch((e) => {
      logger.warn('[devices] adb 列表失败', e.message)
      return []
    }),
    listHdcDevices().catch(() => [])
  ])

  await Promise.all(
    android
      .filter((d) => d.state === 'device')
      .map((d) => enrichAndroidName(d).catch(() => {}))
  )

  const serials = new Set(android.map((d) => d.serial))
  const merged = [...android, ...harmony.filter((d) => !serials.has(d.serial))]
  logger.debug('[devices] 统一列表', merged.map((d) => `${d.platform}:${d.serial}:${d.state}`).join(', '))
  return merged
}

export async function findDevice(id) {
  const devices = await listAllDevices()
  return devices.find((d) => d.id === id || d.serial === id) || null
}
