<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '@/utils/ipc'
import { useDevicesStore } from '@/stores/devices'
import { useAppStore } from '@/stores/app'
import DeviceCard from '@/components/DeviceCard.vue'

const store = useDevicesStore()
const app = useAppStore()
const selectedId = ref(null)
const showCast = ref(false)
const flexibleArgs = ref('')

const selected = computed(() => store.items.find((d) => d.id === selectedId.value) || null)
const canMirror = computed(() => {
  const d = selected.value
  return !!d && d.state === 'device'
})
const isAndroid = computed(() => selected.value?.platform === 'android')

let sessionUnsub = null
let refreshTimer = null

function ensureSelection() {
  const stillExists = store.items.some((d) => d.id === selectedId.value)
  if (!stillExists) {
    const first = store.items.find((d) => d.state === 'device') || store.items[0]
    selectedId.value = first ? first.id : null
  }
}

onMounted(async () => {
  await store.refresh()
  ensureSelection()
  refreshTimer = setInterval(() => { store.refresh(true).then(ensureSelection) }, 6000)
  sessionUnsub = api.scrcpy.onSessionEnded((payload) => {
    const normal = payload.code === 0 || payload.code == null || !payload.message
    let text
    if (payload.mode === 'record' && normal) {
      text = '录制已完成'
    } else if (normal) {
      text = '投屏已结束'
    } else {
      text = `投屏中断${payload.message ? `：${payload.message.slice(0, 80)}` : ''}`
    }
    app.notify(text, normal ? 'info' : 'error')
    store.refresh()
  })
})

onUnmounted(() => {
  if (sessionUnsub) sessionUnsub()
  if (refreshTimer) clearInterval(refreshTimer)
})

function select(device) {
  selectedId.value = selectedId.value === device.id ? null : device.id
}

async function removeDevice(device) {
  const res = await api.devices.disconnect(device.id)
  app.notify(res.ok ? '设备已移除' : res.message || '移除失败', res.ok ? 'success' : 'error')
  if (res.ok && selectedId.value === device.id) selectedId.value = null
  await store.refresh()
}

async function act(fn, okMsg, failMsg) {
  const d = selected.value
  if (!d) return
  const res = await fn(d.id)
  if (okMsg) app.notify(res.ok ? okMsg : res.message || failMsg, res.ok ? 'success' : 'error')
  return res
}

const keyActions = [
  { label: '返回', key: 'back' },
  { label: '主页', key: 'home' },
  { label: '任务', key: 'recents' },
  { label: '电源', key: 'power' },
  { label: '锁屏', key: 'sleep' },
  { label: '音量+', key: 'volumeUp' },
  { label: '音量-', key: 'volumeDown' },
  { label: '菜单', key: 'menu' }
]

function pressKey(key) {
  act((id) => api.control.key(id, key), '', '操作失败')
}

const mirrorActions = [
  { label: '镜像', mode: 'mirror' },
  { label: '录制', mode: 'record' },
  { label: '相机', mode: 'camera' },
  { label: 'OTG', mode: 'otg' }
]

async function startMirror(mode) {
  if (!selected.value) return
  const overrides = mode === 'flexible' ? { rawArgs: flexibleArgs.value } : {}
  const res = await store.startMirror(selected.value, mode, overrides)
  if (res && res.ok) showCast.value = false
}

async function screenshot() {
  const d = selected.value
  if (!d) return
  const res = await api.device.screenshot(d.id)
  if (res.ok) {
    app.notify(`截屏已保存：${res.path}`, 'success')
    api.app.showItem(res.path)
  } else app.notify(res.message || '截屏失败', 'error')
}

async function reboot() {
  act((id) => api.control.reboot(id), '重启指令已发送', '重启失败')
}

async function toggleReverseNet() {
  const status = await api.control.gnirehtetStatus()
  const res = status.running
    ? await api.control.gnirehtetStop()
    : await api.control.gnirehtetStart(selected.value.id)
  app.notify(res.message || '操作完成', res.ok ? 'success' : 'error')
}

async function installApp() {
  const d = selected.value
  if (!d) return
  const picked = await api.app.pickFile({ filters: [{ name: '安装包', extensions: ['apk', 'hap'] }] })
  if (!picked) return
  app.notify('安装中，请稍候…', 'info')
  const res = await api.device.install(d.id, picked)
  app.notify(res.ok ? '安装成功' : res.message || '安装失败', res.ok ? 'success' : 'error')
}

async function shellDialog() {
  const d = selected.value
  if (!d) return
  const cmd = window.prompt('输入设备 shell 命令', 'getprop ro.product.model')
  if (!cmd) return
  const res = await api.device.shell(d.id, cmd)
  app.notify(res.output || res.message || '执行完成', res.ok ? 'info' : 'error')
}

function openDetail() {
  if (!selected.value) return
  location.hash = `#/device/${encodeURIComponent(selected.value.id)}`
}
</script>

<template>
  <div class="page home-page">
    <div class="page-head compact">
      <div>
        <h1 class="page-title">设备</h1>
        <p class="page-desc">连接设备，一键开始投屏与控制</p>
      </div>
      <div class="head-stat">
        <span class="stat-dot"></span>
        <span>{{ store.onlineCount }} 台在线</span>
      </div>
    </div>

    <div class="card connect-card">
      <div class="connect-row">
        <input v-model="store.wifi.host" class="input" placeholder="WiFi 设备 IP，如 192.168.1.5" />
        <input v-model.number="store.wifi.port" class="input port-input" placeholder="5555" />
        <button class="btn primary" @click="store.connectWifi()">WiFi 连接</button>
        <button class="btn ghost refresh-btn" :disabled="store.loading" @click="store.refresh()">
          {{ store.loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="selected" class="card panel-card">
      <div class="panel-head">
        <div class="panel-id">
          <span class="panel-name">{{ selected.name }}</span>
          <span class="mono muted device-id">{{ selected.id }}</span>
          <span class="chip" :class="selected.state === 'device' ? 'green' : 'red'">
            {{ selected.state === 'device' ? '已连接' : '已离线' }}
          </span>
        </div>
        <div class="panel-actions">
          <button class="btn primary small" :disabled="!canMirror" @click="showCast = true">投屏</button>
          <button class="btn ghost small" @click="openDetail">详细管理 →</button>
        </div>
      </div>

      <div class="all-functions">
        <button class="fn-btn cast" :disabled="!canMirror" @click="showCast = true">投屏</button>
        <span class="fn-sep"></span>
        <button v-for="k in keyActions" :key="k.key" class="fn-btn" :disabled="selected.state !== 'device'" @click="pressKey(k.key)">{{ k.label }}</button>
        <span class="fn-sep"></span>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="act(id => api.control.rotate(id, 'auto'))">旋转</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="act(id => api.control.notifications(id, true))">通知栏</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="screenshot">截屏</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="reboot">重启</button>
        <button class="fn-btn" :disabled="selected.state !== 'device' || !isAndroid" @click="toggleReverseNet">反向供网</button>
        <span class="fn-sep"></span>
        <button class="fn-btn" :disabled="!isAndroid" @click="installApp">安装应用</button>
        <button class="fn-btn" @click="shellDialog">执行脚本</button>
        <button class="fn-btn" @click="openDetail">应用管理</button>
        <button class="fn-btn danger" @click="store.stopAll && store.stopAll()">停止全部</button>
        <button class="fn-btn danger" :disabled="selected.connection !== 'wifi'" @click="removeDevice(selected)">断开</button>
      </div>
    </div>

    <div class="card list-card">
      <div class="card-title">
        <span>设备列表</span>
        <span class="muted" style="font-size: 12px; font-weight: 400">{{ store.items.length }} 台设备</span>
      </div>

      <div v-if="!store.items.length" class="empty">
        <div class="empty-icon">▢</div>
        <div>未发现设备</div>
        <div class="muted" style="margin-top: 8px; font-size: 12px">
          请用 USB 连接设备并开启调试，或使用上方 WiFi 连接
        </div>
      </div>

      <div v-else class="dev-list">
        <DeviceCard
          v-for="device in store.items"
          :key="device.id"
          :device="device"
          :selected="selectedId === device.id"
          @select="select"
          @remove="removeDevice"
        />
      </div>
    </div>

    <!-- 投屏独立任务弹窗 -->
    <div v-if="showCast" class="modal-mask" @click.self="showCast = false">
      <div class="cast-modal">
        <div class="modal-head">
          <div>
            <h2 class="modal-title">投屏</h2>
            <p class="modal-sub">{{ selected?.name }} · {{ selected?.id }}</p>
          </div>
          <button class="close-btn" @click="showCast = false">✕</button>
        </div>

        <div class="modal-label">选择投屏模式</div>
        <div class="mode-grid">
          <button
            v-for="a in mirrorActions" :key="a.mode"
            class="mode-btn" :class="{ primary: a.mode === 'mirror' }"
            :disabled="!canMirror || (a.mode !== 'mirror' && !isAndroid)"
            @click="startMirror(a.mode)"
          >{{ a.label }}</button>
        </div>

        <div class="modal-label">灵活启动（自定义参数）</div>
        <div class="flexible-row">
          <input v-model="flexibleArgs" class="input mono" placeholder="如 --turn-screen-off --stay-awake" @keyup.enter="startMirror('flexible')" />
          <button class="btn" :disabled="!canMirror" @click="startMirror('flexible')">启动</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-head.compact {
  margin-bottom: 16px;
  flex-shrink: 0;
}
.page-head.compact .page-title {
  font-size: 23px;
}

.connect-card {
  flex-shrink: 0;
  padding: 14px 16px;
}
.connect-row {
  display: flex;
  gap: 9px;
}
.connect-row .input:first-child {
  flex: 1;
}
.port-input {
  width: 88px;
  flex-shrink: 0;
}
.refresh-btn {
  margin-left: auto;
}

.panel-card {
  flex-shrink: 0;
  padding: 14px 16px;
  margin-top: 14px;
  background: linear-gradient(135deg, var(--surface), var(--surface-2));
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-id {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.panel-name {
  font-size: 15px;
  font-weight: 650;
}
.device-id {
  font-size: 11px;
}
.panel-actions {
  display: flex;
  gap: 8px;
}

.all-functions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}
.fn-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 550;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.fn-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.fn-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.fn-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.fn-btn.cast {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  color: #fff;
  box-shadow: 0 5px 15px rgba(99, 102, 241, 0.3);
}
.fn-btn.cast:hover:not(:disabled) {
  color: #fff;
  filter: brightness(1.06);
}
.fn-btn.danger:hover:not(:disabled) {
  background: var(--danger-soft);
  border-color: var(--danger);
  color: var(--danger);
}
.fn-sep {
  width: 1px;
  height: 20px;
  background: var(--border-strong);
  margin: 0 3px;
}

.list-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 14px;
  padding: 14px 16px;
}
.list-card .card-title {
  margin-bottom: 12px;
  flex-shrink: 0;
}
.dev-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-right: 2px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 14, 0.68);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  animation: fade-in 0.18s ease;
}
.cast-modal {
  width: 440px;
  max-width: calc(100vw - 48px);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow);
  animation: pop-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.modal-title {
  font-size: 20px;
  font-weight: 680;
  margin: 0 0 4px;
}
.modal-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}
.close-btn {
  border: none;
  background: var(--surface-2);
  color: var(--text-dim);
  width: 30px;
  height: 30px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 14px;
}
.close-btn:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.modal-note {
  font-size: 12px;
  color: var(--warning);
  background: var(--warning-soft);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  margin: 0 0 16px;
}
.modal-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  margin: 16px 0 10px;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 9px;
}
.mode-btn {
  height: 42px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.mode-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.mode-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.mode-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.mode-btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  color: #fff;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.3);
}
.mode-btn.primary:hover:not(:disabled) {
  color: #fff;
  filter: brightness(1.06);
}
.flexible-row {
  display: flex;
  gap: 9px;
}
.flexible-row .input {
  flex: 1;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
