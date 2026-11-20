<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/ipc'
import { useDevicesStore } from '@/stores/devices'
import { useAppStore } from '@/stores/app'
import DeviceCard from '@/components/DeviceCard.vue'

const { t } = useI18n()
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
      text = t('action.recordDone')
    } else if (normal) {
      text = t('action.castEnded')
    } else {
      text = payload.message ? t('action.castInterrupted', { message: '：' + payload.message.slice(0, 80) }) : t('action.castInterrupted', { message: '' })
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
  app.notify(res.ok ? t('action.deviceRemoved') : res.message || t('action.removeFail'), res.ok ? 'success' : 'error')
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
  { label: 'keys.back', key: 'back' },
  { label: 'keys.home', key: 'home' },
  { label: 'keys.recents', key: 'recents' },
  { label: 'keys.power', key: 'power' },
  { label: 'keys.sleep', key: 'sleep' },
  { label: 'keys.volumeUp', key: 'volumeUp' },
  { label: 'keys.volumeDown', key: 'volumeDown' },
  { label: 'keys.menu', key: 'menu' }
]

function pressKey(key) {
  act((id) => api.control.key(id, key), '', t('action.opFail'))
}

const mirrorActions = [
  { label: 'modes.mirror', mode: 'mirror' },
  { label: 'modes.record', mode: 'record' },
  { label: 'modes.camera', mode: 'camera' },
  { label: 'modes.otg', mode: 'otg' }
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
    app.notify(t('action.screenshotSaved', { path: res.path }), 'success')
    api.app.showItem(res.path)
  } else app.notify(res.message || t('action.screenshotFail'), 'error')
}

async function reboot() {
  act((id) => api.control.reboot(id), t('action.rebootSent'), t('action.rebootFail'))
}

async function toggleReverseNet() {
  const status = await api.control.gnirehtetStatus()
  const res = status.running
    ? await api.control.gnirehtetStop()
    : await api.control.gnirehtetStart(selected.value.id)
  app.notify(res.message || t('action.opDone'), res.ok ? 'success' : 'error')
}

async function installApp() {
  const d = selected.value
  if (!d) return
  const picked = await api.app.pickFile({ filters: [{ name: t('action.installPkg'), extensions: ['apk', 'hap'] }] })
  if (!picked) return
  app.notify(t('action.installing'), 'info')
  const res = await api.device.install(d.id, picked)
  app.notify(res.ok ? t('action.installSuccess') : res.message || t('action.installFail'), res.ok ? 'success' : 'error')
}

async function shellDialog() {
  const d = selected.value
  if (!d) return
  const cmd = window.prompt(t('action.shellPrompt'), 'getprop ro.product.model')
  if (!cmd) return
  const res = await api.device.shell(d.id, cmd)
  app.notify(res.output || res.message || t('action.execDone'), res.ok ? 'info' : 'error')
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
        <h1 class="page-title">{{ t('home.title') }}</h1>
        <p class="page-desc">{{ t('home.desc') }}</p>
      </div>
      <div class="head-stat">
        <span class="stat-dot"></span>
        <span>{{ t('home.online', { count: store.onlineCount }) }}</span>
      </div>
    </div>

    <div class="card connect-card">
      <div class="connect-row">
        <input v-model="store.wifi.host" class="input" :placeholder="t('home.wifiIpPlaceholder')" />
        <input v-model.number="store.wifi.port" class="input port-input" placeholder="5555" />
        <button class="btn primary" @click="store.connectWifi()">{{ t('home.wifiConnect') }}</button>
        <button class="btn ghost refresh-btn" :disabled="store.loading" @click="store.refresh()">
          {{ store.loading ? t('home.refreshing') : t('home.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="selected" class="card panel-card">
      <div class="panel-head">
        <div class="panel-id">
          <span class="panel-name">{{ selected.name }}</span>
          <span class="mono muted device-id">{{ selected.id }}</span>
          <span class="chip" :class="selected.state === 'device' ? 'green' : 'red'">
            {{ selected.state === 'device' ? t('home.connected') : t('home.offline') }}
          </span>
        </div>
        <div class="panel-actions">
          <button class="btn primary small" :disabled="!canMirror" @click="showCast = true">{{ t('home.cast') }}</button>
          <button class="btn ghost small" @click="openDetail">{{ t('home.detailManage') }}</button>
        </div>
      </div>

      <div class="all-functions">
        <button class="fn-btn cast" :disabled="!canMirror" @click="showCast = true">{{ t('home.cast') }}</button>
        <span class="fn-sep"></span>
        <button v-for="k in keyActions" :key="k.key" class="fn-btn" :disabled="selected.state !== 'device'" @click="pressKey(k.key)">{{ t(k.label) }}</button>
        <span class="fn-sep"></span>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="act(id => api.control.rotate(id, 'auto'))">{{ t('home.rotate') }}</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="act(id => api.control.notifications(id, true))">{{ t('home.notifications') }}</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="screenshot">{{ t('home.screenshot') }}</button>
        <button class="fn-btn" :disabled="selected.state !== 'device'" @click="reboot">{{ t('home.reboot') }}</button>
        <button class="fn-btn" :disabled="selected.state !== 'device' || !isAndroid" @click="toggleReverseNet">{{ t('home.reverseNet') }}</button>
        <span class="fn-sep"></span>
        <button class="fn-btn" :disabled="!isAndroid" @click="installApp">{{ t('home.installApp') }}</button>
        <button class="fn-btn" @click="shellDialog">{{ t('home.runScript') }}</button>
        <button class="fn-btn" @click="openDetail">{{ t('home.appManage') }}</button>
        <button class="fn-btn danger" @click="store.stopAll && store.stopAll()">{{ t('home.stopAll') }}</button>
        <button class="fn-btn danger" :disabled="selected.connection !== 'wifi'" @click="removeDevice(selected)">{{ t('home.disconnect') }}</button>
      </div>
    </div>

    <div class="card list-card">
      <div class="card-title">
        <span>{{ t('home.deviceList') }}</span>
        <span class="muted" style="font-size: 12px; font-weight: 400">{{ t('home.devicesCount', { count: store.items.length }) }}</span>
      </div>

      <div v-if="!store.items.length" class="empty">
        <div class="empty-icon">▢</div>
        <div>{{ t('home.noDevice') }}</div>
        <div class="muted" style="margin-top: 8px; font-size: 12px">
          {{ t('home.noDeviceHint') }}
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
            <h2 class="modal-title">{{ t('home.castModalTitle') }}</h2>
            <p class="modal-sub">{{ selected?.name }} · {{ selected?.id }}</p>
          </div>
          <button class="close-btn" @click="showCast = false">✕</button>
        </div>

        <div class="modal-label">{{ t('home.chooseMode') }}</div>
        <div class="mode-grid">
          <button
            v-for="a in mirrorActions" :key="a.mode"
            class="mode-btn" :class="{ primary: a.mode === 'mirror' }"
            :disabled="!canMirror || (a.mode !== 'mirror' && !isAndroid)"
            @click="startMirror(a.mode)"
          >{{ t(a.label) }}</button>
        </div>

        <div class="modal-label">{{ t('home.flexibleMode') }}</div>
        <div class="flexible-row">
          <input v-model="flexibleArgs" class="input mono" :placeholder="t('home.flexiblePlaceholder')" @keyup.enter="startMirror('flexible')" />
          <button class="btn" :disabled="!canMirror" @click="startMirror('flexible')">{{ t('home.start') }}</button>
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
