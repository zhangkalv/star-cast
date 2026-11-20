<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/utils/ipc'
import { useSettingsStore } from '@/stores/settings'
import { setAppLocale, SUPPORTED_LOCALES } from '@/i18n'
import SettingField from '@/components/SettingField.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const frameModels = ref([])
const activeSection = ref('general')

const tr = (v) => (typeof v === 'string' && v.startsWith('@') ? t(v.slice(1)) : v)

const sectionsDef = [
  {
    key: 'general',
    title: '@settings.general',
    fields: [
      { key: 'language', label: '@settings.language', type: 'select', options: SUPPORTED_LOCALES.map((l) => ({ value: l, label: '@lang.' + l })) },
      { key: 'theme', label: '@settings.theme', type: 'select', options: [
        { value: 'dark', label: '@app.themeDark' }, { value: 'light', label: '@app.themeLight' }, { value: 'system', label: '@app.themeSystem' }
      ] },
      { key: 'storagePath', label: '@settings.storagePath', type: 'path', kind: 'directory', placeholder: '@settings.storagePathHint' },
      { key: 'adbPath', label: '@settings.adbPath', type: 'path', kind: 'file', placeholder: '@settings.autoFind' },
      { key: 'scrcpyPath', label: '@settings.scrcpyPath', type: 'path', kind: 'file', placeholder: '@settings.autoFind' },
      { key: 'hdcPath', label: '@settings.hdcPath', type: 'path', kind: 'file', placeholder: '@settings.autoFind' },
      { key: 'gnirehtetPath', label: '@settings.gnirehtetPath', type: 'path', kind: 'file', placeholder: '@settings.autoFind' },
      { key: 'scrcpyExtraArgs', label: '@settings.extraArgs', type: 'text', placeholder: '@settings.extraArgsHint' },
      { key: 'autoConnect', label: '@settings.autoConnect', hint: '@settings.autoConnectHint', type: 'toggle' },
      { key: 'autoMirror', label: '@settings.autoMirror', hint: '@settings.autoMirrorHint', type: 'toggle' },
      { key: 'floatingControlBar', label: '@settings.floatingBar', hint: '@settings.floatingBarHint', type: 'toggle' },
      { key: 'debug', label: '@settings.debugMode', type: 'toggle' }
    ]
  },
  {
    key: 'video',
    title: '@settings.video',
    fields: [
      { key: 'enabled', label: '@settings.videoForward', type: 'toggle' },
      { key: 'maxSize', label: '@settings.maxSize', hint: '@settings.maxSizeHint', type: 'number' },
      { key: 'bitRate', label: '@settings.videoBitrate', type: 'text', placeholder: '8M' },
      { key: 'fps', label: '@settings.maxFps', type: 'number' },
      { key: 'codec', label: '@settings.videoCodec', type: 'select', options: [
        { value: 'h264', label: 'H.264' }, { value: 'h265', label: 'H.265' }, { value: 'av1', label: 'AV1' }
      ] },
      { key: 'orientation', label: '@settings.displayOrientation', type: 'select', options: [
        { value: '0', label: '@settings.natural' }, { value: '1', label: '90°' }, { value: '2', label: '180°' }, { value: '3', label: '270°' }
      ] },
      { key: 'crop', label: '@settings.crop', type: 'text', placeholder: '@settings.ratioPlaceholder' },
      { key: 'displayId', label: '@settings.displayId', type: 'text', placeholder: '@settings.displayIdHint' },
      { key: 'bufferMs', label: '@settings.videoBuffer', type: 'number' },
      { key: 'v4l2BufferMs', label: '@settings.v4l2Buffer', type: 'number' }
    ]
  },
  {
    key: 'audio',
    title: '@settings.audio',
    fields: [
      { key: 'enabled', label: '@settings.audioForward', type: 'toggle' },
      { key: 'source', label: '@settings.audioSource', type: 'select', options: [
        { value: 'output', label: '@settings.deviceAudio' }, { value: 'mic', label: '@settings.microphone' }, { value: 'playback', label: '@settings.appAudio' }
      ] },
      { key: 'codec', label: '@settings.audioCodec', type: 'select', options: [
        { value: 'opus', label: 'Opus' }, { value: 'aac', label: 'AAC' }, { value: 'flac', label: 'FLAC' }, { value: 'raw', label: 'Raw' }
      ] },
      { key: 'bitRate', label: '@settings.audioBitrate', type: 'text', placeholder: '128k' },
      { key: 'bufferMs', label: '@settings.audioBuffer', type: 'number' },
      { key: 'outputBufferMs', label: '@settings.audioOutBuffer', type: 'number' }
    ]
  },
  {
    key: 'window',
    title: '@settings.window',
    fields: [
      { key: 'width', label: '@settings.windowWidth', type: 'number' },
      { key: 'height', label: '@settings.windowHeight', type: 'number' },
      { key: 'x', label: '@settings.windowX', hint: '@settings.centerHint', type: 'number' },
      { key: 'y', label: '@settings.windowY', hint: '@settings.centerHint', type: 'number' },
      { key: 'borderless', label: '@settings.noBorder', type: 'toggle' },
      { key: 'fullscreen', label: '@settings.fullscreen', type: 'toggle' },
      { key: 'alwaysOnTop', label: '@settings.alwaysTop', type: 'toggle' },
      { key: 'disableScreensaver', label: '@settings.disableScreensaver', type: 'toggle' }
    ]
  },
  {
    key: 'device',
    title: '@settings.behavior',
    fields: [
      { key: 'showTouches', label: '@settings.showTouches', type: 'toggle' },
      { key: 'stayAwake', label: '@settings.keepAwake', type: 'toggle' },
      { key: 'powerOffOnClose', label: '@settings.screenOff', type: 'toggle' }
    ]
  },
  {
    key: 'input',
    title: '@settings.input',
    fields: [
      { key: 'mouseMode', label: '@settings.mouseMode', type: 'select', options: [
        { value: 'sdk', label: 'SDK' }, { value: 'uhid', label: 'UHID' }, { value: 'aoa', label: 'AOA' }
      ] },
      { key: 'mouseBind', label: '@settings.mouseBind', hint: '@settings.bindHint', type: 'text' },
      { key: 'keyboardMode', label: '@settings.keyboardMode', hint: '@settings.uhidHint', type: 'select', options: [
        { value: 'sdk', label: 'SDK' }, { value: 'uhid', label: '@settings.uhid' }, { value: 'aoa', label: 'AOA' }
      ] },
      { key: 'gamepad', label: '@settings.gamepad', type: 'select', options: [
        { value: 'disabled', label: '@settings.disabled' }, { value: 'sdk', label: 'SDK' }, { value: 'uhid', label: 'UHID' }, { value: 'aoa', label: 'AOA' }
      ] }
    ]
  },
  {
    key: 'record',
    title: '@settings.recording',
    fields: [
      { key: 'format', label: '@settings.recordFormat', type: 'select', options: [
        { value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }
      ] },
      { key: 'orientation', label: '@settings.recordOrientation', type: 'select', options: [
        { value: '0', label: '@settings.natural' }, { value: '1', label: '90°' }, { value: '2', label: '180°' }, { value: '3', label: '270°' }
      ] },
      { key: 'durationSec', label: '@settings.duration', hint: '@settings.noLimitHint', type: 'number' },
      { key: 'noPlayback', label: '@settings.recordNoPlay', type: 'toggle' },
      { key: 'noAudioPlayback', label: '@settings.recordNoAudio', type: 'toggle' }
    ]
  },
  {
    key: 'camera',
    title: '@settings.cameraCapture',
    fields: [
      { key: 'size', label: '@settings.cameraSize', type: 'text', placeholder: '@settings.cameraSizeHint' },
      { key: 'facing', label: '@settings.cameraFacing', type: 'select', options: [
        { value: 'front', label: '@settings.front' }, { value: 'back', label: '@settings.back' }, { value: 'external', label: '@settings.external' }
      ] },
      { key: 'fps', label: '@settings.cameraFps', type: 'number' }
    ]
  },
  {
    key: 'frame',
    title: '@settings.frame',
    fields: [
      { key: 'enabled', label: '@settings.enableFrame', hint: '@settings.frameOutside', type: 'toggle' },
      { key: 'model', label: '@settings.frameStyle', type: 'select', options: [] },
      { key: 'opacity', label: '@settings.frameOpacity', hint: '0.1 ~ 1', type: 'number' }
    ]
  }
]

const sections = computed(() => sectionsDef.map((s) => ({
  ...s,
  title: tr(s.title),
  fields: s.fields.map((f) => ({
    ...f,
    label: tr(f.label),
    hint: tr(f.hint),
    placeholder: tr(f.placeholder),
    options: (f.options || []).map((o) => ({ ...o, label: tr(o.label) }))
  }))
})))

const current = () => sections.value.find((s) => s.key === activeSection.value) || sections.value[0]

function fieldOptions(sectionKey, field) {
  if (sectionKey === 'frame' && field.key === 'model') {
    return frameModels.value.map((m) => ({ value: m.id, label: m.name }))
  }
  return field.options || []
}

function onFieldUpdate(field, value) {
  if (current().key === 'general' && field.key === 'language') {
    settings.patch('general', 'language', value)
    setAppLocale(value)
  } else {
    settings.patch(current().key, field.key, value)
  }
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  try {
    frameModels.value = await api.frame.models()
  } catch {
    frameModels.value = []
  }
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ t('app.settings') }}</h1>
        <p class="page-desc">{{ t('settings.appearanceDesc') }}</p>
      </div>
    </div>

    <template v-if="settings.data">
      <div class="tabs">
        <button
          v-for="section in sections"
          :key="section.key"
          class="tab"
          :class="{ active: activeSection === section.key }"
          @click="activeSection = section.key"
        >{{ section.title }}</button>
      </div>

      <div class="card">
        <div class="card-title">{{ current().title }}</div>
        <SettingField
          v-for="field in current().fields"
          :key="field.key"
          :label="field.label"
          :hint="field.hint"
          :type="field.type"
          :kind="field.kind"
          :placeholder="field.placeholder"
          :options="fieldOptions(current().key, field)"
          :model-value="settings.data[current().key][field.key]"
          @update:model-value="onFieldUpdate(field, $event)"
        />
      </div>

      <div class="save-bar">
        <button class="btn primary" :disabled="settings.saving" @click="settings.save()">
          {{ settings.saving ? t('settings.saving') : t('settings.save') }}
        </button>
        <button class="btn danger" @click="settings.reset()">{{ t('settings.reset') }}</button>
        <span class="muted" style="font-size: 12px">
          {{ t('action.exitBeforeConfig') }}
        </span>
      </div>
    </template>

    <div v-else class="muted">{{ t('device.loading') }}</div>
  </div>
</template>

<style scoped>
.save-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 22px;
  flex-wrap: wrap;
}
</style>
