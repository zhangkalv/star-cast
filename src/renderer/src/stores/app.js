import { defineStore } from 'pinia'
import { api } from '@/utils/ipc'

export const useAppStore = defineStore('app', {
  state: () => ({
    theme: 'dark',
    toasts: [],
    appInfo: null
  }),
  actions: {
    async init() {
      const config = await api.config.get()
      this.theme = config.general?.theme || 'dark'
      this.applyTheme()
      this.appInfo = await api.app.getInfo()
    },
    applyTheme() {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
      const isLight = this.theme === 'light' || (this.theme === 'system' && prefersLight)
      document.documentElement.dataset.theme = isLight ? 'light' : 'dark'
    },
    async setTheme(theme) {
      this.theme = theme
      this.applyTheme()
      await api.config.set({ general: { theme } })
    },
    notify(message, type = 'info') {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      this.toasts.push({ id, message, type })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, 3400)
    }
  }
})
