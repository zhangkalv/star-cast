<script setup>
import { onMounted, ref } from 'vue'
import { api } from '@/utils/ipc'
import { useSettingsStore } from '@/stores/settings'
import SettingField from '@/components/SettingField.vue'

const settings = useSettingsStore()
const frameModels = ref([])
const activeSection = ref('general')

const sections = [
  {
    key: 'general',
    title: '通用',
    fields: [
      {
        key: 'theme',
        label: '主题',
        type: 'select',
        options: [
          { value: 'dark', label: '深色' },
          { value: 'light', label: '浅色' },
          { value: 'system', label: '跟随系统' }
        ]
      },
      { key: 'storagePath', label: '文件存储路径', type: 'path', kind: 'directory', placeholder: '默认为视频/图片目录下「星点投屏」' },
      { key: 'adbPath', label: 'ADB 路径', type: 'path', kind: 'file', placeholder: '留空自动查找' },
      { key: 'scrcpyPath', label: 'Scrcpy 路径', type: 'path', kind: 'file', placeholder: '留空自动查找' },
      { key: 'hdcPath', label: 'HDC 路径（鸿蒙）', type: 'path', kind: 'file', placeholder: '留空自动查找' },
      { key: 'gnirehtetPath', label: 'Gnirehtet 路径', type: 'path', kind: 'file', placeholder: '留空自动查找' },
      { key: 'scrcpyExtraArgs', label: 'Scrcpy 附加参数', type: 'text', placeholder: '如 --turn-screen-off' },
      { key: 'autoConnect', label: '自动连接设备', hint: '应用启动时自动连接历史设备', type: 'toggle' },
      { key: 'autoMirror', label: '自动执行镜像', hint: '设备接入后自动开始投屏', type: 'toggle' },
      { key: 'floatingControlBar', label: '浮动控制栏', hint: '投屏时显示独立浮动控制条', type: 'toggle' },
      { key: 'debug', label: '调试模式', type: 'toggle' }
    ]
  },
  {
    key: 'video',
    title: '视频',
    fields: [
      { key: 'enabled', label: '视频转发', type: 'toggle' },
      { key: 'maxSize', label: '最大尺寸', hint: '按长边缩放，0 为不缩放', type: 'number' },
      { key: 'bitRate', label: '视频码率', type: 'text', placeholder: '8M' },
      { key: 'fps', label: '最大帧率', type: 'number' },
      {
        key: 'codec',
        label: '视频编码',
        type: 'select',
        options: [
          { value: 'h264', label: 'H.264' },
          { value: 'h265', label: 'H.265' },
          { value: 'av1', label: 'AV1' }
        ]
      },
      {
        key: 'orientation',
        label: '显示方向',
        type: 'select',
        options: [
          { value: '0', label: '自然' },
          { value: '1', label: '90°' },
          { value: '2', label: '180°' },
          { value: '3', label: '270°' }
        ]
      },
      { key: 'crop', label: '屏幕裁剪', type: 'text', placeholder: '宽:高:x:y' },
      { key: 'displayId', label: '显示器 ID', type: 'text', placeholder: '留空使用默认' },
      { key: 'bufferMs', label: '视频缓冲 (ms)', type: 'number' },
      { key: 'v4l2BufferMs', label: 'v4l2 缓冲 (ms)', type: 'number' }
    ]
  },
  {
    key: 'audio',
    title: '音频',
    fields: [
      { key: 'enabled', label: '音频转发', type: 'toggle' },
      {
        key: 'source',
        label: '音频源',
        type: 'select',
        options: [
          { value: 'output', label: '设备输出（扬声器）' },
          { value: 'mic', label: '麦克风' },
          { value: 'playback', label: '应用回放' }
        ]
      },
      {
        key: 'codec',
        label: '音频编码',
        type: 'select',
        options: [
          { value: 'opus', label: 'Opus' },
          { value: 'aac', label: 'AAC' },
          { value: 'flac', label: 'FLAC' },
          { value: 'raw', label: 'Raw' }
        ]
      },
      { key: 'bitRate', label: '音频码率', type: 'text', placeholder: '128k' },
      { key: 'bufferMs', label: '音频缓冲 (ms)', type: 'number' },
      { key: 'outputBufferMs', label: '音频输出缓冲 (ms)', type: 'number' }
    ]
  },
  {
    key: 'window',
    title: '窗口',
    fields: [
      { key: 'width', label: '窗口宽度', type: 'number' },
      { key: 'height', label: '窗口高度', type: 'number' },
      { key: 'x', label: '窗口横坐标', hint: '-1 为居中', type: 'number' },
      { key: 'y', label: '窗口纵坐标', hint: '-1 为居中', type: 'number' },
      { key: 'borderless', label: '无边框模式', type: 'toggle' },
      { key: 'fullscreen', label: '全屏模式', type: 'toggle' },
      { key: 'alwaysOnTop', label: '始终置顶', type: 'toggle' },
      { key: 'disableScreensaver', label: '禁用屏幕保护', type: 'toggle' }
    ]
  },
  {
    key: 'device',
    title: '设备行为',
    fields: [
      { key: 'showTouches', label: '展示触摸点', type: 'toggle' },
      { key: 'stayAwake', label: '保持唤醒', type: 'toggle' },
      { key: 'powerOffOnClose', label: '控制结束关闭屏幕', type: 'toggle' }
    ]
  },
  {
    key: 'input',
    title: '输入',
    fields: [
      {
        key: 'mouseMode',
        label: '鼠标模式',
        type: 'select',
        options: [
          { value: 'sdk', label: 'SDK' },
          { value: 'uhid', label: 'UHID' },
          { value: 'aoa', label: 'AOA' }
        ]
      },
      { key: 'mouseBind', label: '鼠标绑定', hint: '如 bhsn（左/右/中/侧键）', type: 'text' },
      {
        key: 'keyboardMode',
        label: '键盘模式',
        hint: '中文输入推荐 uhid',
        type: 'select',
        options: [
          { value: 'sdk', label: 'SDK' },
          { value: 'uhid', label: 'UHID（中文输入）' },
          { value: 'aoa', label: 'AOA' }
        ]
      },
      {
        key: 'gamepad',
        label: '游戏手柄',
        type: 'select',
        options: [
          { value: 'disabled', label: '禁用' },
          { value: 'sdk', label: 'SDK' },
          { value: 'uhid', label: 'UHID' },
          { value: 'aoa', label: 'AOA' }
        ]
      }
    ]
  },
  {
    key: 'record',
    title: '录制',
    fields: [
      {
        key: 'format',
        label: '录制格式',
        type: 'select',
        options: [
          { value: 'mp4', label: 'MP4' },
          { value: 'mkv', label: 'MKV' }
        ]
      },
      {
        key: 'orientation',
        label: '录制方向',
        type: 'select',
        options: [
          { value: '0', label: '自然' },
          { value: '1', label: '90°' },
          { value: '2', label: '180°' },
          { value: '3', label: '270°' }
        ]
      },
      { key: 'durationSec', label: '录制时长 (秒)', hint: '0 为不限制', type: 'number' },
      { key: 'noPlayback', label: '录制时禁用播放', type: 'toggle' },
      { key: 'noAudioPlayback', label: '录制时禁用音频播放', type: 'toggle' }
    ]
  },
  {
    key: 'camera',
    title: '摄像',
    fields: [
      { key: 'size', label: '摄像尺寸', type: 'text', placeholder: '如 1920x1080' },
      {
        key: 'facing',
        label: '摄像头朝向',
        type: 'select',
        options: [
          { value: 'front', label: '前置' },
          { value: 'back', label: '后置' },
          { value: 'external', label: '外接' }
        ]
      },
      { key: 'fps', label: '摄像帧率', type: 'number' }
    ]
  },
  {
    key: 'frame',
    title: '机型边框',
    fields: [
      { key: 'enabled', label: '启用机型边框', hint: '投屏窗口外显示手机外壳', type: 'toggle' },
      { key: 'model', label: '边框样式', type: 'select', options: [] },
      { key: 'opacity', label: '边框透明度', hint: '0.1 ~ 1', type: 'number' }
    ]
  }
]

const current = () => sections.find((s) => s.key === activeSection.value) || sections[0]

function fieldOptions(sectionKey, field) {
  if (sectionKey === 'frame' && field.key === 'model') {
    return frameModels.value.map((m) => ({ value: m.id, label: m.name }))
  }
  return field.options || []
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
        <h1 class="page-title">设置</h1>
        <p class="page-desc">调整投屏画质、窗口、输入与外观偏好</p>
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
          @update:model-value="settings.patch(current().key, field.key, $event)"
        />
      </div>

      <div class="save-bar">
        <button class="btn primary" :disabled="settings.saving" @click="settings.save()">
          {{ settings.saving ? '保存中…' : '保存设置' }}
        </button>
        <button class="btn danger" @click="settings.reset()">恢复默认</button>
        <span class="muted" style="font-size: 12px">
          修改配置文件前请先彻底退出应用
        </span>
      </div>
    </template>

    <div v-else class="muted">加载中…</div>
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
