<script setup>
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/ipc'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()

const props = defineProps({
  deviceId: { type: String, required: true },
  disabled: { type: Boolean, default: false }
})

const app = useAppStore()

const keys = [
  { key: 'back', label: 'keys.back' },
  { key: 'home', label: 'keys.home' },
  { key: 'recents', label: 'keys.recents' },
  { key: 'power', label: 'keys.power' },
  { key: 'volumeUp', label: 'keys.volumeUp' },
  { key: 'volumeDown', label: 'keys.volumeDown' },
  { key: 'sleep', label: 'keys.sleep' },
  { key: 'menu', label: 'keys.menu' }
]

async function press(key) {
  const res = await api.control.key(props.deviceId, key)
  if (!res.ok) app.notify(res.message || t('action.opFail'), 'error')
}

async function rotate() {
  const res = await api.control.rotate(props.deviceId, 'auto')
  if (!res.ok) app.notify(res.message || t('action.rotateFail'), 'error')
}

async function notifications() {
  const res = await api.control.notifications(props.deviceId, true)
  if (!res.ok) app.notify(res.message || t('action.notifFail'), 'error')
}

async function screenshot() {
  const res = await api.device.screenshot(props.deviceId)
  if (res.ok) {
    app.notify(t('action.screenshotSaved', { path: res.path }), 'success')
    api.app.showItem(res.path)
  } else {
    app.notify(res.message || t('action.screenshotFail'), 'error')
  }
}

async function reboot() {
  const res = await api.control.reboot(props.deviceId)
  app.notify(res.ok ? t('action.rebootSent') : res.message || t('action.rebootFail'), res.ok ? 'success' : 'error')
}

async function gnirehtet() {
  const status = await api.control.gnirehtetStatus()
  const res = status.running ? await api.control.gnirehtetStop() : await api.control.gnirehtetStart(props.deviceId)
  app.notify(res.message || t('action.opDone'), res.ok ? 'success' : 'error')
}

const extra = [
  { label: 'home.rotate', fn: rotate },
  { label: 'home.notifications', fn: notifications },
  { label: 'home.screenshot', fn: screenshot },
  { label: 'home.reboot', fn: reboot },
  { label: 'home.reverseNet', fn: gnirehtet }
]
</script>

<template>
  <div class="control-bar">
    <button v-for="item in keys" :key="item.key" class="ctrl-btn" :disabled="disabled" @click="press(item.key)">
      {{ t(item.label) }}
    </button>
    <button v-for="item in extra" :key="item.label" class="ctrl-btn" :disabled="disabled" @click="item.fn">
      {{ t(item.label) }}
    </button>
  </div>
</template>

<style scoped>
.control-bar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 9px;
}

.ctrl-btn {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 12px 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 550;
  font-family: inherit;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.1s ease;
}

.ctrl-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.ctrl-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.ctrl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
