<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDevicesStore } from '@/stores/devices'

const { t } = useI18n()

const props = defineProps({
  device: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'remove'])

const router = useRouter()
const store = useDevicesStore()

const activeSessions = computed(() =>
  store.sessions.filter((s) => s.deviceId === props.device.id)
)
const online = computed(() => props.device.state === 'device')

function openDetail() {
  router.push(`/device/${encodeURIComponent(props.device.id)}`)
}
</script>

<template>
  <div class="dev-row" :class="{ selected }" @click="emit('select', device)">
    <div class="check" :class="{ on: selected }"></div>

    <div class="dev-main">
      <div class="dev-name-line">
        <span class="dev-name">{{ device.name }}</span>
        <span v-if="device.connection === 'wifi'" class="dev-tag">WiFi</span>
        <span v-if="activeSessions.length" class="dev-tag live">{{ t('home.casting') }}</span>
      </div>
      <div class="dev-id mono">{{ device.serial }}</div>
    </div>

    <span class="dev-state" :class="online ? 'on' : 'off'">
      <span class="state-dot"></span>
      {{ online ? t('home.connected') : t('home.offline') }}
    </span>

    <div class="dev-actions">
      <button class="text-btn" @click.stop="openDetail">{{ t('device.detail') }}</button>
      <button class="text-btn danger" @click.stop="emit('remove', device)">{{ t('device.remove') }}</button>
    </div>
  </div>
</template>

<style scoped>
.dev-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.12s ease;
}
.dev-row:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
}
.dev-row.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.check {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: 2px solid var(--border-strong);
  border-radius: 6px;
  transition: background 0.16s ease, border-color 0.16s ease;
  position: relative;
}
.check.on {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
}
.check.on::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.dev-main {
  flex: 1;
  min-width: 0;
}
.dev-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dev-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dev-tag {
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 2px 7px;
  white-space: nowrap;
}
.dev-tag.live {
  color: var(--warning);
  background: var(--warning-soft);
}
.dev-id {
  color: var(--text-faint);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dev-state {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
}
.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dev-state.on {
  color: var(--success);
}
.dev-state.on .state-dot {
  background: var(--success);
  box-shadow: 0 0 0 4px var(--success-soft);
}
.dev-state.off {
  color: var(--text-faint);
}
.dev-state.off .state-dot {
  background: var(--text-faint);
}

.dev-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.text-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.text-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}
.text-btn.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
