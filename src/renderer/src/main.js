import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'
import i18n, { setAppLocale } from './i18n'
import { api } from './utils/ipc'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.mount('#app')

api.config.get().then((config) => {
  if (config?.general?.language) setAppLocale(config.general.language)
}).catch(() => {})
