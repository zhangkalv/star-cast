<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/ipc'
import { useDevicesStore } from '@/stores/devices'
import { useAppStore } from '@/stores/app'
import ControlBar from '@/components/ControlBar.vue'

const { t } = useI18n()

const props = defineProps({
  id: { type: String, required: true }
})

const store = useDevicesStore()
const app = useAppStore()

const device = computed(() => store.byId(decodeURIComponent(props.id)))
const flexibleArgs = ref('')

const packages = ref([])
const packagesLoading = ref(false)
const appLabels = reactive({})

const filePath = ref('/sdcard')
const fileEntries = ref([])
const fileLoading = ref(false)
const selectedFiles = ref([])
const thumbs = ref({})
const downloading = ref(false)
const fileView = ref('grid')

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i
function isImage(name) {
  return IMAGE_RE.test(name || '')
}

const ALBUM_PATHS = ['/sdcard/DCIM/Camera', '/sdcard/DCIM', '/sdcard/Pictures']
const albumPath = ref('')

const shellCommand = ref('getprop ro.product.model')
const shellOutput = ref('')

onMounted(async () => {
  if (!store.items.length) await store.refresh()
  if (device.value) {
    if (device.value.platform === 'android') loadPackages()
    loadFiles()
  }
})

async function loadPackages() {
  packagesLoading.value = true
  try {
    const res = await api.device.listPackages(device.value.id)
    packages.value = res.packages || []
    if (!res.ok) app.notify(res.message || t('action.appListFail'), 'error')
    if (packages.value.length) {
      try {
        const fn = api.device.appLabels
        if (typeof fn !== 'function') {
          app.notify(t('action.appNameUnavailable'), 'error')
        } else {
          fn(device.value.id, JSON.parse(JSON.stringify(packages.value))).then((r) => {
            if (r && r.labels) Object.assign(appLabels, r.labels)
          }).catch((e) => app.notify(t('action.appNameParseFail') + (e.message || e), 'error'))
        }
      } catch (e) {
        app.notify(t('action.appNameCallFail') + (e.message || e), 'error')
      }
    }
  } finally {
    packagesLoading.value = false
  }
}

async function openAlbum() {
  if (!device.value) return
  for (const p of ALBUM_PATHS) {
    const res = await api.device.listFiles(device.value.id, p)
    if (res.ok && res.entries && res.entries.length) {
      filePath.value = p
      await loadFiles()
      return
    }
  }
  app.notify(t('action.albumNotFound'), 'info')
}

async function launchPackage(pkg) {
  const res = await api.device.launchPackage(device.value.id, pkg)
  app.notify(res.ok ? t('action.launched', { pkg }) : res.message || t('action.startFail'), res.ok ? 'success' : 'error')
}

async function uninstallPackage(pkg) {
  const res = await api.device.uninstall(device.value.id, pkg)
  app.notify(res.ok ? t('action.uninstalled', { pkg }) : res.message || t('action.uninstallFail'), res.ok ? 'success' : 'error')
  if (res.ok) loadPackages()
}

async function loadFiles() {
  fileLoading.value = true
  selectedFiles.value = []
  thumbs.value = {}
  try {
    const res = await api.device.listFiles(device.value.id, filePath.value)
    fileEntries.value = res.entries || []
    if (!res.ok) app.notify(res.message || t('action.dirLoadFail'), 'error')
    const images = fileEntries.value.filter((e) => !e.isDir && isImage(e.name)).slice(0, 300)
    let cursor = 0
    const loadNext = async () => {
      while (cursor < images.length) {
        const e = images[cursor++]
        const remote = `${filePath.value.replace(/\/$/, '')}/${e.name}`
        try {
          const r = await api.device.thumbnail(device.value.id, remote)
          if (r && r.ok && r.dataUrl) thumbs.value = { ...thumbs.value, [e.name]: r.dataUrl }
        } catch {}
      }
    }
    Promise.all([loadNext(), loadNext(), loadNext()])
  } finally {
    fileLoading.value = false
  }
}

function enterDir(name) {
  filePath.value = `${filePath.value.replace(/\/$/, '')}/${name.replace(/\/$/, '')}`
  loadFiles()
}

async function pullFile(name) {
  const remotePath = `${filePath.value.replace(/\/$/, '')}/${name}`
  const res = await api.device.pull(device.value.id, remotePath)
  if (res.ok) {
    app.notify(t('action.savedTo', { path: res.path }), 'success')
    api.app.showItem(res.path)
  } else {
    app.notify(res.message || t('action.pullFail'), 'error')
  }
}

function toggleSelect(name) {
  const i = selectedFiles.value.indexOf(name)
  if (i >= 0) selectedFiles.value.splice(i, 1)
  else selectedFiles.value.push(name)
}

function selectAllFiles() {
  const files = fileEntries.value.filter((e) => !e.isDir).map((e) => e.name)
  selectedFiles.value = selectedFiles.value.length === files.length ? [] : files
}

async function downloadSelected() {
  if (!selectedFiles.value.length) {
    app.notify(t('action.selectFileFirst'), 'info')
    return
  }
  const targetDir = await api.app.pickDirectory()
  if (!targetDir) return
  downloading.value = true
  try {
    const paths = selectedFiles.value.map((name) => `${filePath.value.replace(/\/$/, '')}/${name}`)
    const res = await api.device.pullBatch(device.value.id, paths, targetDir)
    app.notify(res.message || (res.ok ? t('action.downloadDone') : t('action.downloadFail')), res.ok ? 'success' : 'error')
    if (res.ok) {
      api.app.showItem(targetDir)
      selectedFiles.value = []
    }
  } finally {
    downloading.value = false
  }
}

async function pushFile() {
  const localPath = await api.app.pickFile()
  if (!localPath) return
  const remotePath = `${filePath.value.replace(/\/$/, '')}/${localPath.split(/[\\/]/).pop()}`
  const res = await api.device.push(device.value.id, localPath, remotePath)
  app.notify(res.ok ? t('action.uploadSuccess') : res.message || t('action.uploadFail'), res.ok ? 'success' : 'error')
  if (res.ok) loadFiles()
}

async function runShell() {
  const res = await api.device.shell(device.value.id, shellCommand.value)
  shellOutput.value = res.output || res.message || ''
  if (!res.ok) app.notify(res.message || t('action.execFail'), 'error')
}

async function installApp() {
  const filePath = await api.app.pickFile({
    filters: [{ name: t('action.installPkg'), extensions: ['apk', 'hap'] }]
  })
  if (!filePath) return
  app.notify(t('action.installing'), 'info')
  const res = await api.device.install(device.value.id, filePath)
  app.notify(res.ok ? t('action.installSuccess') : res.message || t('action.installFail'), res.ok ? 'success' : 'error')
}

async function startMode(mode) {
  const overrides = mode === 'flexible' ? { rawArgs: flexibleArgs.value } : {}
  await store.startMirror(device.value, mode, overrides)
}

const platformLabel = computed(() => ({ android: 'Android', harmonyos: t('device.harmonyos') }))
const canMirror = computed(() => device.value?.state === 'device')
</script>

<template>
  <div v-if="device" class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ device.name }}</h1>
        <p class="page-desc">
          <span class="chip blue">{{ platformLabel[device.platform] }}</span>
          <span class="chip">{{ device.connection === 'wifi' ? 'WiFi' : 'USB' }}</span>
          <span class="chip" :class="device.state === 'device' ? 'green' : 'red'">
            {{ device.state === 'device' ? t('device.online') : t('device.offline') }}
          </span>
          <span class="mono muted" style="margin-left: 4px">{{ device.serial }}</span>
        </p>
      </div>
      <router-link to="/" class="btn ghost">{{ t('device.backToList') }}</router-link>
    </div>

    <div class="card">
      <div class="card-title">{{ t('device.castMode') }}</div>
      <div class="row">
        <button class="btn primary" :disabled="!canMirror" @click="startMode('mirror')">{{ t('modes.mirror') }}</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('record')">{{ t('modes.recordVideo') }}</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('camera')">{{ t('modes.cameraMirror') }}</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('otg')">{{ t('modes.otgMode') }}</button>
      </div>
      <div class="row flexible-row">
        <input v-model="flexibleArgs" class="input mono" :placeholder="t('device.flexibleDesc')" />
        <button class="btn" :disabled="!canMirror" @click="startMode('flexible')">{{ t('device.flexibleLaunch') }}</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">{{ t('device.deviceInteraction') }}</div>
      <ControlBar :device-id="device.id" :disabled="device.state !== 'device'" />
    </div>

    <div class="card">
      <div class="card-title">
        <span>{{ t('device.appManage') }}</span>
        <span class="muted" style="font-size: 12px; font-weight: 400">
          {{ device.platform === 'android' ? t('device.appCount', { count: packages.length }) : t('device.platformWip') }}
        </span>
      </div>
      <div class="row" style="margin-bottom: 12px">
        <button class="btn small" @click="loadPackages">{{ t('home.refresh') }}</button>
        <button class="btn small" @click="installApp">{{ t('home.installApp') }}</button>
      </div>
      <div v-if="packagesLoading" class="muted">{{ t('device.loading') }}</div>
      <div v-else-if="packages.length" class="list-box">
        <div v-for="pkg in packages" :key="pkg" class="list-row">
          <div class="app-info">
            <span class="app-name">{{ appLabels[pkg] || pkg }}</span>
            <span class="mono app-pkg">{{ pkg }}</span>
          </div>
          <button class="btn small" @click="launchPackage(pkg)">{{ t('device.launch') }}</button>
          <button class="btn danger small" @click="uninstallPackage(pkg)">{{ t('device.uninstall') }}</button>
        </div>
      </div>
      <div v-else class="muted" style="padding: 10px 0">{{ t('device.noData') }}</div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>{{ t('device.fileManage') }}</span>
        <div class="view-switch">
          <button :class="{ on: fileView === 'list' }" @click="fileView = 'list'">{{ t('device.listView') }}</button>
          <button :class="{ on: fileView === 'grid' }" @click="fileView = 'grid'">{{ t('device.thumbView') }}</button>
        </div>
      </div>
      <div class="row" style="margin-bottom: 12px">
        <input v-model="filePath" class="input mono" style="flex: 1" @keyup.enter="loadFiles" />
        <button class="btn small" @click="loadFiles">{{ t('device.open') }}</button>
        <button class="btn small" @click="openAlbum">{{ t('device.album') }}</button>
        <button class="btn small" @click="pushFile">{{ t('device.uploadFile') }}</button>
      </div>

      <div v-if="fileEntries.length" class="batch-bar">
        <label class="check-all">
          <input type="checkbox" :checked="selectedFiles.length && selectedFiles.length === fileEntries.filter(e => !e.isDir).length" @change="selectAllFiles" />
          {{ t('device.selectAll') }}
        </label>
        <span class="muted" style="font-size: 12px">{{ t('device.selectedCount', { count: selectedFiles.length }) }}</span>
        <button class="btn primary small" :disabled="!selectedFiles.length || downloading" @click="downloadSelected">
          {{ downloading ? t('device.downloading') : t('device.batchDownload') }}
        </button>
      </div>

      <div v-if="fileLoading" class="muted">{{ t('device.loading') }}</div>

      <!-- 列表视图 -->
      <div v-else-if="fileEntries.length && fileView === 'list'" class="list-box">
        <div v-for="entry in fileEntries" :key="entry.name" class="list-row">
          <input
            v-if="!entry.isDir" type="checkbox" class="file-check"
            :checked="selectedFiles.includes(entry.name)" @change="toggleSelect(entry.name)"
          />
          <span v-else class="file-check-placeholder"></span>
          <img v-if="!entry.isDir && isImage(entry.name) && thumbs[entry.name]" :src="thumbs[entry.name]" class="mini-thumb" />
          <span class="mono" style="flex: 1; cursor: pointer" @click="entry.isDir && enterDir(entry.name)">
            {{ entry.name }}
          </span>
          <button v-if="!entry.isDir" class="btn small" @click="pullFile(entry.name)">{{ t('device.download') }}</button>
        </div>
      </div>

      <!-- 缩略图视图 -->
      <div v-else-if="fileEntries.length && fileView === 'grid'" class="thumb-grid">
        <div v-for="entry in fileEntries" :key="entry.name" class="thumb-item" :class="{ picked: selectedFiles.includes(entry.name) }">
          <div class="thumb-box" @click="entry.isDir ? enterDir(entry.name) : (!isImage(entry.name) && toggleSelect(entry.name))">
            <img v-if="!entry.isDir && isImage(entry.name) && thumbs[entry.name]" :src="thumbs[entry.name]" />
            <div v-else class="thumb-ph">{{ entry.isDir ? t('device.folder') : (isImage(entry.name) ? t('device.image') : t('device.file')) }}</div>
            <input
              v-if="!entry.isDir" type="checkbox" class="thumb-check"
              :checked="selectedFiles.includes(entry.name)" @click.stop="toggleSelect(entry.name)"
            />
          </div>
          <div class="thumb-name" :title="entry.name">{{ entry.name }}</div>
        </div>
      </div>

      <div v-else class="muted" style="padding: 10px 0">{{ t('device.noData') }}</div>
    </div>

    <div class="card">
      <div class="card-title">{{ t('device.runScript') }}</div>
      <div class="row" style="margin-bottom: 12px">
        <input v-model="shellCommand" class="input mono" style="flex: 1" :placeholder="t('device.shellPlaceholder')" @keyup.enter="runShell" />
        <button class="btn primary small" @click="runShell">{{ t('device.execute') }}</button>
      </div>
      <pre class="terminal">{{ shellOutput || t('device.executeResultHint') }}</pre>
    </div>
  </div>

  <div v-else class="empty">
    <div class="empty-icon">?</div>
    <div>{{ t('device.notFound') }}</div>
    <router-link to="/" class="btn" style="margin-top: 16px">{{ t('device.backToListPlain') }}</router-link>
  </div>
</template>

<style scoped>
.page-desc {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hint-block {
  font-size: 12px;
  margin: -6px 0 14px;
}
.flexible-row {
  margin-top: 14px;
}
.flexible-row .input {
  flex: 1;
}
.list-box {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}
.list-row:last-child {
  border-bottom: none;
}
.app-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.app-name {
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-pkg {
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-switch {
  display: flex;
  gap: 4px;
  background: var(--surface-2);
  border-radius: 9px;
  padding: 3px;
}
.view-switch button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 7px;
  cursor: pointer;
}
.view-switch button.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 12px;
  margin-bottom: 12px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}
.check-all {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
.batch-bar button {
  margin-left: auto;
}

.file-check {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
  flex-shrink: 0;
}
.file-check-placeholder {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.mini-thumb {
  width: 34px;
  height: 34px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.thumb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 12px;
  max-height: 70vh;
  overflow: auto;
}
.thumb-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px;
  background: var(--surface-2);
}
.thumb-item.picked {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.thumb-box {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-3);
  cursor: pointer;
}
.thumb-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 12px;
}
.thumb-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 17px;
  height: 17px;
  accent-color: var(--accent);
  cursor: pointer;
}
.thumb-name {
  font-size: 11px;
  margin-top: 6px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
}
</style>
