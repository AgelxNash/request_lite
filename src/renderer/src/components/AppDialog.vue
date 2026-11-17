<script setup>
import { reactive, ref } from 'vue'

// Собственный модальный диалог: window.prompt/confirm недоступны в Electron.
// Два режима: prompt (ввод текста: create/rename) и confirm (подтверждение: delete).
const visible = ref(false)
const mode = ref('prompt')
const config = reactive({
  title: '',
  label: '',
  message: '',
  value: '',
  confirmText: 'ОК',
  danger: false
})
const inputValue = ref('')
const inputEl = ref(null)
let resolver = null

function open(nextMode, cfg) {
  mode.value = nextMode
  Object.assign(config, {
    title: cfg.title ?? '',
    label: cfg.label ?? '',
    message: cfg.message ?? '',
    value: cfg.value ?? '',
    confirmText: cfg.confirmText ?? (nextMode === 'alert' ? 'Понятно' : nextMode === 'prompt' ? 'ОК' : 'Подтвердить'),
    danger: cfg.danger ?? nextMode === 'confirm'
  })
  inputValue.value = config.value
  visible.value = true
  requestAnimationFrame(() => inputEl.value?.focus())
}

function finish(result) {
  visible.value = false
  const resolve = resolver
  resolver = null
  resolve?.(result)
}

function submit() {
  if (mode.value === 'prompt') {
    const value = inputValue.value.trim()
    finish(value === '' ? null : value) // пустое имя = отмена
  } else {
    finish(true) // confirm и alert
  }
}

function cancel() {
  finish(mode.value === 'prompt' ? null : false)
}

defineExpose({
  prompt: (cfg) =>
    new Promise((resolve) => {
      resolver = resolve
      open('prompt', cfg)
    }),
  confirm: (cfg) =>
    new Promise((resolve) => {
      resolver = resolve
      open('confirm', cfg)
    }),
  // Информационное сообщение с одной кнопкой (ошибки импорта и пр.).
  alert: (cfg) =>
    new Promise((resolve) => {
      resolver = resolve
      open('alert', cfg)
    })
})
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @mousedown.self="cancel">
    <div class="dialog" role="dialog" :aria-label="config.title">
      <h3 class="dialog-title">{{ config.title }}</h3>
      <p v-if="mode === 'confirm' || mode === 'alert'" class="dialog-message">{{ config.message }}</p>
      <template v-else>
        <label class="dialog-label" for="app-dialog-input">{{ config.label }}</label>
        <input
          id="app-dialog-input"
          ref="inputEl"
          v-model="inputValue"
          class="dialog-input"
          type="text"
          spellcheck="false"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="cancel"
        />
      </template>
      <div class="dialog-actions">
        <button class="btn" @click="cancel">Отмена</button>
        <button
          class="btn"
          :class="mode === 'confirm' ? 'btn-danger' : 'btn-primary'"
          @click="submit"
        >
          {{ config.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
