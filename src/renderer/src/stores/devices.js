import { defineStore } from 'pinia'
import { api } from '@/utils/ipc'
import { useAppStore } from './app'

export const useDevicesStore = defineStore('devices', {
  state: () => ({
    items: [],
    loading: false,
    sessions: [],
    wifi: { host: '', port: 5555 }
  }),
  getters: {
    byId: (state) => (id) => state.items.find((d) => d.id === id || d.serial === id),
    onlineCount: (state) => state.items.filter((d) => d.state === 'device').length
  },
  actions: {
    async refresh(silent = false) {
      if (!silent) this.loading = true
      try {
        this.items = await api.devices.list()
        this.sessions = await api.scrcpy.list()
      } catch (e) {
        if (!silent) useAppStore().notify(`设备列表刷新失败：${e.message}`, 'error')
      } finally {
        if (!silent) this.loading = false
      }
    },
    async connectWifi() {
      const app = useAppStore()
      const res = await api.devices.connectWifi(this.wifi.host, Number(this.wifi.port) || 5555)
      app.notify(res.message || (res.ok ? '已连接' : '连接失败'), res.ok ? 'success' : 'error')
      if (res.ok) await this.refresh()
      return res
    },
    async startMirror(device, mode = 'mirror', overrides = {}) {
      const app = useAppStore()
      const res = await api.scrcpy.start({
        deviceId: device.id,
        platform: device.platform,
        deviceName: device.name,
        mode,
        overrides
      })
      app.notify(res.message || (res.ok ? '已启动' : '启动失败'), res.ok ? 'success' : 'error')
      if (res.ok) this.sessions = await api.scrcpy.list()
      return res
    },
    async stopSession(sessionId) {
      const res = await api.scrcpy.stop(sessionId)
      this.sessions = await api.scrcpy.list()
      return res
    },
    async stopAll() {
      const res = await api.scrcpy.stopAll()
      this.sessions = await api.scrcpy.list()
      return res
    }
  }
})
