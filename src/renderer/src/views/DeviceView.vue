<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '@/utils/ipc'
import { useDevicesStore } from '@/stores/devices'
import { useAppStore } from '@/stores/app'
import ControlBar from '@/components/ControlBar.vue'

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
    if (!res.ok) app.notify(res.message || '应用列表加载失败', 'error')
    if (packages.value.length) {
      try {
        const fn = api.device.appLabels
        if (typeof fn !== 'function') {
          app.notify('应用名接口不可用，请重启应用', 'error')
        } else {
          fn(device.value.id, JSON.parse(JSON.stringify(packages.value))).then((r) => {
            if (r && r.labels) Object.assign(appLabels, r.labels)
          }).catch((e) => app.notify('应用名解析失败：' + (e.message || e), 'error'))
        }
      } catch (e) {
        app.notify('应用名调用异常：' + (e.message || e), 'error')
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
  app.notify('未找到相册目录', 'info')
}

async function launchPackage(pkg) {
  const res = await api.device.launchPackage(device.value.id, pkg)
  app.notify(res.ok ? `已启动 ${pkg}` : res.message || '启动失败', res.ok ? 'success' : 'error')
}

async function uninstallPackage(pkg) {
  const res = await api.device.uninstall(device.value.id, pkg)
  app.notify(res.ok ? `已卸载 ${pkg}` : res.message || '卸载失败', res.ok ? 'success' : 'error')
  if (res.ok) loadPackages()
}

async function loadFiles() {
  fileLoading.value = true
  selectedFiles.value = []
  thumbs.value = {}
  try {
    const res = await api.device.listFiles(device.value.id, filePath.value)
    fileEntries.value = res.entries || []
    if (!res.ok) app.notify(res.message || '目录加载失败', 'error')
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
    app.notify(`已保存到 ${res.path}`, 'success')
    api.app.showItem(res.path)
  } else {
    app.notify(res.message || '拉取失败', 'error')
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
    app.notify('请先勾选要下载的文件', 'info')
    return
  }
  const targetDir = await api.app.pickDirectory()
  if (!targetDir) return
  downloading.value = true
  try {
    const paths = selectedFiles.value.map((name) => `${filePath.value.replace(/\/$/, '')}/${name}`)
    const res = await api.device.pullBatch(device.value.id, paths, targetDir)
    app.notify(res.message || (res.ok ? '下载完成' : '下载失败'), res.ok ? 'success' : 'error')
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
  app.notify(res.ok ? '上传成功' : res.message || '上传失败', res.ok ? 'success' : 'error')
  if (res.ok) loadFiles()
}

async function runShell() {
  const res = await api.device.shell(device.value.id, shellCommand.value)
  shellOutput.value = res.output || res.message || ''
  if (!res.ok) app.notify(res.message || '执行失败', 'error')
}

async function installApp() {
  const filePath = await api.app.pickFile({
    filters: [{ name: '安装包', extensions: ['apk', 'hap'] }]
  })
  if (!filePath) return
  app.notify('安装中，请稍候…', 'info')
  const res = await api.device.install(device.value.id, filePath)
  app.notify(res.ok ? '安装成功' : res.message || '安装失败', res.ok ? 'success' : 'error')
}

async function startMode(mode) {
  const overrides = mode === 'flexible' ? { rawArgs: flexibleArgs.value } : {}
  await store.startMirror(device.value, mode, overrides)
}

const platformLabel = { android: 'Android', harmonyos: '鸿蒙' }
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
            {{ device.state === 'device' ? '在线' : '离线' }}
          </span>
          <span class="mono muted" style="margin-left: 4px">{{ device.serial }}</span>
        </p>
      </div>
      <router-link to="/" class="btn ghost">← 返回设备列表</router-link>
    </div>

    <div class="card">
      <div class="card-title">投屏模式</div>
      <div class="row">
        <button class="btn primary" :disabled="!canMirror" @click="startMode('mirror')">镜像</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('record')">录制视频</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('camera')">相机镜像</button>
        <button class="btn" :disabled="!canMirror || device.platform !== 'android'" @click="startMode('otg')">OTG 模式</button>
      </div>
      <div class="row flexible-row">
        <input v-model="flexibleArgs" class="input mono" placeholder="灵活启动：自定义 scrcpy 参数，如 --turn-screen-off --stay-awake" />
        <button class="btn" :disabled="!canMirror" @click="startMode('flexible')">灵活启动</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">设备交互</div>
      <ControlBar :device-id="device.id" :disabled="device.state !== 'device'" />
    </div>

    <div class="card">
      <div class="card-title">
        <span>应用管理</span>
        <span class="muted" style="font-size: 12px; font-weight: 400">
          {{ device.platform === 'android' ? `共 ${packages.length} 个第三方应用` : '该平台建设中' }}
        </span>
      </div>
      <div class="row" style="margin-bottom: 12px">
        <button class="btn small" @click="loadPackages">刷新</button>
        <button class="btn small" @click="installApp">安装应用</button>
      </div>
      <div v-if="packagesLoading" class="muted">加载中…</div>
      <div v-else-if="packages.length" class="list-box">
        <div v-for="pkg in packages" :key="pkg" class="list-row">
          <div class="app-info">
            <span class="app-name">{{ appLabels[pkg] || pkg }}</span>
            <span class="mono app-pkg">{{ pkg }}</span>
          </div>
          <button class="btn small" @click="launchPackage(pkg)">启动</button>
          <button class="btn danger small" @click="uninstallPackage(pkg)">卸载</button>
        </div>
      </div>
      <div v-else class="muted" style="padding: 10px 0">暂无数据</div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>文件管理</span>
        <div class="view-switch">
          <button :class="{ on: fileView === 'list' }" @click="fileView = 'list'">列表</button>
          <button :class="{ on: fileView === 'grid' }" @click="fileView = 'grid'">缩略图</button>
        </div>
      </div>
      <div class="row" style="margin-bottom: 12px">
        <input v-model="filePath" class="input mono" style="flex: 1" @keyup.enter="loadFiles" />
        <button class="btn small" @click="loadFiles">打开</button>
        <button class="btn small" @click="openAlbum">相册</button>
        <button class="btn small" @click="pushFile">上传文件</button>
      </div>

      <div v-if="fileEntries.length" class="batch-bar">
        <label class="check-all">
          <input type="checkbox" :checked="selectedFiles.length && selectedFiles.length === fileEntries.filter(e => !e.isDir).length" @change="selectAllFiles" />
          全选
        </label>
        <span class="muted" style="font-size: 12px">已选 {{ selectedFiles.length }} 项</span>
        <button class="btn primary small" :disabled="!selectedFiles.length || downloading" @click="downloadSelected">
          {{ downloading ? '下载中…' : '批量下载' }}
        </button>
      </div>

      <div v-if="fileLoading" class="muted">加载中…</div>

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
          <button v-if="!entry.isDir" class="btn small" @click="pullFile(entry.name)">下载</button>
        </div>
      </div>

      <!-- 缩略图视图 -->
      <div v-else-if="fileEntries.length && fileView === 'grid'" class="thumb-grid">
        <div v-for="entry in fileEntries" :key="entry.name" class="thumb-item" :class="{ picked: selectedFiles.includes(entry.name) }">
          <div class="thumb-box" @click="entry.isDir ? enterDir(entry.name) : (!isImage(entry.name) && toggleSelect(entry.name))">
            <img v-if="!entry.isDir && isImage(entry.name) && thumbs[entry.name]" :src="thumbs[entry.name]" />
            <div v-else class="thumb-ph">{{ entry.isDir ? '文件夹' : (isImage(entry.name) ? '图片' : '文件') }}</div>
            <input
              v-if="!entry.isDir" type="checkbox" class="thumb-check"
              :checked="selectedFiles.includes(entry.name)" @click.stop="toggleSelect(entry.name)"
            />
          </div>
          <div class="thumb-name" :title="entry.name">{{ entry.name }}</div>
        </div>
      </div>

      <div v-else class="muted" style="padding: 10px 0">暂无数据</div>
    </div>

    <div class="card">
      <div class="card-title">执行脚本</div>
      <div class="row" style="margin-bottom: 12px">
        <input v-model="shellCommand" class="input mono" style="flex: 1" placeholder="输入设备 shell 命令" @keyup.enter="runShell" />
        <button class="btn primary small" @click="runShell">执行</button>
      </div>
      <pre class="terminal">{{ shellOutput || '执行结果将显示在这里' }}</pre>
    </div>
  </div>

  <div v-else class="empty">
    <div class="empty-icon">?</div>
    <div>未找到设备</div>
    <router-link to="/" class="btn" style="margin-top: 16px">返回设备列表</router-link>
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
