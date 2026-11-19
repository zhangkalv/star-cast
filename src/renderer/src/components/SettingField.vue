<script setup>
import { api } from '@/utils/ipc'

const props = defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  type: { type: String, default: 'text' },
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  kind: { type: String, default: 'file' }
})

const emit = defineEmits(['update:modelValue'])

function normalizeOptions() {
  return props.options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt
  )
}

async function browse() {
  const picked =
    props.kind === 'directory'
      ? await api.app.pickDirectory()
      : await api.app.pickFile()
  if (picked) emit('update:modelValue', picked)
}
</script>

<template>
  <div class="setting-row">
    <div class="setting-label">
      <div class="name">{{ label }}</div>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </div>

    <div
      v-if="type === 'toggle'"
      class="switch"
      :class="{ on: modelValue }"
      @click="emit('update:modelValue', !modelValue)"
    ></div>

    <select
      v-else-if="type === 'select'"
      class="select"
      :value="modelValue"
      @change="emit('update:modelValue', $event.target.value)"
    >
      <option v-for="opt in normalizeOptions()" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <div v-else-if="type === 'path'" class="row" style="flex: 1.2; justify-content: flex-end">
      <input
        class="input mono"
        style="flex: 1"
        :value="modelValue"
        :placeholder="placeholder"
        @input="emit('update:modelValue', $event.target.value)"
      />
      <button class="btn small" @click="browse">浏览</button>
    </div>

    <input
      v-else
      class="input"
      style="width: 190px; text-align: right"
      :type="type === 'number' ? 'number' : 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', type === 'number' ? Number($event.target.value) : $event.target.value)"
    />
  </div>
</template>
