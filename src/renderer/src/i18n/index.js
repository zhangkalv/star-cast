import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import en from './locales/en'
import ja from './locales/ja'
import ko from './locales/ko'
import de from './locales/de'
import fr from './locales/fr'
import es from './locales/es'

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'de', 'fr', 'es']

export function normalizeLocale(value) {
  if (!value) return 'zh-CN'
  const v = String(value)
  if (SUPPORTED_LOCALES.includes(v)) return v
  const base = v.split('-')[0].toLowerCase()
  if (base === 'zh') return v.includes('TW') || v.includes('HK') || v.includes('MO') ? 'zh-TW' : 'zh-CN'
  const found = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === base)
  return found || 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko, de, fr, es }
})

export function setAppLocale(value) {
  i18n.global.locale.value = normalizeLocale(value)
}

export default i18n
