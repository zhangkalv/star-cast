<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/utils/ipc'
import logoUrl from '@/assets/logo.png'

const route = useRoute()
const app = useAppStore()

function openQQ() {
  api.app.openExternal('https://qm.qq.com/q/mLK9LOpix4')
}

const checking = ref(false)
const updateInfo = ref(null)

async function checkForUpdate() {
  checking.value = true
  try {
    const r = await api.app.checkUpdate()
    if (!r || !r.ok) {
      app.notify('检查更新失败，请稍后重试', 'error')
      return
    }
    updateInfo.value = r
    if (!r.hasUpdate) app.notify(`已是最新版本 v${r.current}`, 'success')
  } finally {
    checking.value = false
  }
}

function downloadUpdate() {
  if (updateInfo.value?.packageUrl) {
    api.app.openDownload(updateInfo.value.packageUrl)
    updateInfo.value = null
  } else {
    app.notify('暂未提供下载地址，可加入 QQ 群获取', 'info')
  }
}

const navs = [
  { path: '/', label: '设备' },
  { path: '/settings', label: '设置' }
]

const themeLabel = computed(() => ({ dark: '深色', light: '浅色', system: '跟随系统' })[app.theme] || '深色')

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

onMounted(() => {
  app.init()
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo" :src="logoUrl" alt="星点投屏" />
        <div>
          <div class="brand-name">星点投屏</div>
          <div class="brand-sub">一键投屏 · 轻松掌控</div>
        </div>
      </div>

      <div class="nav-label">主菜单</div>
      <router-link
        v-for="nav in navs"
        :key="nav.path"
        :to="nav.path"
        class="nav-item"
        :class="{ active: isActive(nav.path) }"
      >
        {{ nav.label }}
      </router-link>

      <div style="flex: 1"></div>

      <button class="qq-group" @click="openQQ">
        <span class="qq-label">加入 QQ 群</span>
        <span class="qq-sub">交流 · 反馈 · 更新</span>
      </button>

      <button class="check-update-btn" :disabled="checking" @click="checkForUpdate">
        {{ checking ? '检查中…' : `检查更新 · v${app.appInfo?.version || ''}` }}
      </button>

      <div class="theme-box">
        <div class="theme-title">外观主题</div>
        <div class="theme-options">
          <button
            v-for="t in ['dark', 'light', 'system']"
            :key="t"
            class="theme-opt"
            :class="{ on: app.theme === t }"
            @click="app.setTheme(t)"
          >{{ { dark: '深色', light: '浅色', system: '自动' }[t] }}</button>
        </div>
      </div>
    </aside>

    <main class="content">
      <router-view />
    </main>

    <div class="toast-wrap">
      <div v-for="toast in app.toasts" :key="toast.id" class="toast" :class="toast.type">
        {{ toast.message }}
      </div>
    </div>

    <div v-if="updateInfo && updateInfo.hasUpdate" class="update-mask" @click.self="updateInfo = null">
      <div class="update-card">
        <h2>发现新版本</h2>
        <div class="update-ver">v{{ updateInfo.current }} → v{{ updateInfo.version }}</div>
        <div v-if="updateInfo.notes" class="update-notes">{{ updateInfo.notes }}</div>
        <div class="update-actions">
          <button class="btn ghost" @click="updateInfo = null">稍后</button>
          <button class="btn primary" @click="downloadUpdate">下载更新</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qq-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.32);
  transition: transform 0.12s ease, filter 0.16s ease;
}
.qq-group:hover { filter: brightness(1.08); }
.qq-group:active { transform: scale(0.98); }
.qq-label { font-size: 14px; font-weight: 650; }
.qq-sub { font-size: 11px; opacity: 0.85; }

.check-update-btn {
  width: 100%;
  margin-bottom: 14px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.check-update-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
.check-update-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.update-mask {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 14, 0.68);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 600;
}
.update-card {
  width: 400px;
  max-width: calc(100vw - 48px);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 26px;
  box-shadow: var(--shadow);
}
.update-card h2 { margin: 0 0 10px; font-size: 20px; }
.update-ver { color: var(--accent); font-weight: 600; margin-bottom: 14px; }
.update-notes {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.7;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  margin-bottom: 22px;
}
.update-actions { display: flex; justify-content: flex-end; gap: 10px; }

.theme-box {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.theme-title {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 1px;
  padding: 0 4px 10px;
}
.theme-options {
  display: flex;
  gap: 4px;
  background: var(--surface-2);
  border-radius: 11px;
  padding: 4px;
}
.theme-opt {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 12px;
  padding: 7px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.theme-opt:hover {
  color: var(--text);
}
.theme-opt.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}
</style>
