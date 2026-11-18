import { execFileSync } from 'child_process'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { configStore } from '../config.js'
import { resolveBinary } from './binary-locator.js'
import { logger } from '../logger.js'

function iosTool(key) {
  return resolveBinary(key, configStore.get().general.iosToolPath)
}

function tryExec(bin, args, timeout = 10000) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', timeout, windowsHide: true })
  } catch (e) {
    logger.debug('[ios] 命令失败', bin, args.join(' '), e.message)
    return null
  }
}

/** iOS 设备发现（libimobiledevice：idevice_id + ideviceinfo） */
export async function listIosDevices() {
  const ideviceId = iosTool('idevice_id')
  if (!ideviceId) return []
  const out = tryExec(ideviceId, ['-l'])
  if (!out) return []
  const items = []
  for (const udid of out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    let name = udid
    const ideviceInfo = iosTool('ideviceinfo')
    if (ideviceInfo) {
      const deviceName = tryExec(ideviceInfo, ['-u', udid, '-k', 'DeviceName'])
      const productType = tryExec(ideviceInfo, ['-u', udid, '-k', 'ProductType'])
      if (deviceName) name = deviceName.trim()
      items.push({
        id: udid,
        serial: udid,
        platform: 'ios',
        name,
        model: (productType || '').trim(),
        state: 'device',
        connection: 'usb',
        transportId: ''
      })
    } else {
      items.push({
        id: udid,
        serial: udid,
        platform: 'ios',
        name,
        model: '',
        state: 'device',
        connection: 'usb',
        transportId: ''
      })
    }
  }
  return items
}

export async function iosScreenshot(udid, savePath) {
  const bin = iosTool('idevicescreenshot')
  if (!bin) return { ok: false, message: '未找到 idevicescreenshot，请安装 libimobiledevice 或指定路径' }
  mkdirSync(dirname(savePath), { recursive: true })
  const out = tryExec(bin, ['-u', udid, savePath], 30000)
  if (out === null) return { ok: false, message: 'idevicescreenshot 执行失败' }
  return { ok: true, path: savePath }
}

export async function iosStartMirror() {
  return {
    ok: false,
    message: 'iOS 镜像通道建设中（规划走 AirPlay 接收组件），当前可使用「截屏」功能'
  }
}

export async function iosControl() {
  return { ok: false, message: 'iOS 远程控制通道建设中' }
}
