import { defineStore } from 'pinia'
import { api } from '@/utils/ipc'
import { useAppStore } from './app'
import i18n from '@/i18n'

const t = (key) => i18n.global.t(key)

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
        useAppStore().notify(t('action.saved'), 'success')
      } finally {
        this.saving = false
      }
    },
    async reset() {
      this.data = await api.config.reset()
      useAppStore().notify(t('action.resetDone'), 'success')
    },
    patch(section, key, value) {
      if (this.data && this.data[section]) this.data[section][key] = value
    }
  }
})
