import { defineStore } from 'pinia'
import { api } from '@/utils/ipc'
import { useAppStore } from './app'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    data: null,
    loaded: false,
    saving: false
  }),
  actions: {
    async load() {
      this.data = await api.config.get()
      this.loaded = true
    },
    async save() {
      this.saving = true
      try {
        this.data = await api.config.set(this.data)
        useAppStore().notify('设置已保存', 'success')
      } finally {
        this.saving = false
      }
    },
    async reset() {
      this.data = await api.config.reset()
      useAppStore().notify('已恢复默认设置', 'success')
    },
    patch(section, key, value) {
      if (this.data && this.data[section]) this.data[section][key] = value
    }
  }
})
