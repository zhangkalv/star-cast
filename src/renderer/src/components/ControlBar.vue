<script setup>
import { api } from '@/utils/ipc'
import { useAppStore } from '@/stores/app'

const props = defineProps({
  deviceId: { type: String, required: true },
  disabled: { type: Boolean, default: false }
})

const app = useAppStore()

const keys = [
  { key: 'back', label: '返回' },
  { key: 'home', label: '主页' },
  { key: 'recents', label: '任务' },
  { key: 'power', label: '电源' },
  { key: 'volumeUp', label: '音量+' },
  { key: 'volumeDown', label: '音量-' },
  { key: 'sleep', label: '锁屏' },
  { key: 'menu', label: '菜单' }
]

async function press(key) {
  const res = await api.control.key(props.deviceId, key)
  if (!res.ok) app.notify(res.message || '操作失败', 'error')
}

async function rotate() {
  const res = await api.control.rotate(props.deviceId, 'auto')
  if (!res.ok) app.notify(res.message || '旋转失败', 'error')
}

async function notifications() {
  const res = await api.control.notifications(props.deviceId, true)
  if (!res.ok) app.notify(res.message || '展开通知栏失败', 'error')
}

async function screenshot() {
  const res = await api.device.screenshot(props.deviceId)
  if (res.ok) {
    app.notify(`截屏已保存：${res.path}`, 'success')
    api.app.showItem(res.path)
  } else {
    app.notify(res.message || '截屏失败', 'error')
  }
}

async function reboot() {
  const res = await api.control.reboot(props.deviceId)
  app.notify(res.ok ? '重启指令已发送' : res.message || '重启失败', res.ok ? 'success' : 'error')
}

async function gnirehtet() {
  const status = await api.control.gnirehtetStatus()
  const res = status.running ? await api.control.gnirehtetStop() : await api.control.gnirehtetStart(props.deviceId)
  app.notify(res.message || '操作完成', res.ok ? 'success' : 'error')
}

const extra = [
  { label: '旋转', fn: rotate },
  { label: '通知栏', fn: notifications },
  { label: '截屏', fn: screenshot },
  { label: '重启', fn: reboot },
  { label: '反向供网', fn: gnirehtet }
]
</script>

<template>
  <div class="control-bar">
    <button v-for="item in keys" :key="item.key" class="ctrl-btn" :disabled="disabled" @click="press(item.key)">
      {{ item.label }}
    </button>
    <button v-for="item in extra" :key="item.label" class="ctrl-btn" :disabled="disabled" @click="item.fn">
      {{ item.label }}
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
