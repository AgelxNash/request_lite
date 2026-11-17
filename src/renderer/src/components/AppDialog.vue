<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

// Собственный модальный диалог: window.prompt/confirm недоступны в Electron.
// Режимы: prompt (ввод текста), confirm (подтверждение), alert (сообщение).
// Enter — согласие, Esc — отмена, на уровне документа (фокус может быть где угодно).
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

// Enter/Esc на уровне документа: диалог может быть открыт при фокусе где угодно.
// finish() обнуляет resolver — двойной вызов (input + document) безопасен.
function onDocumentKeydown(event) {
  if (!visible.value) return
  if (event.key === 'Enter') {
    event.preventDefault()
    submit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

defineExpose({
  visible, // чужим Esc-обработчикам: AppDialog открыт — Esc достаётся ему
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
        />
      </template>
      <div class="dialog-actions">
        <button v-if="mode !== 'alert'" class="btn" @click="cancel">Отмена</button>
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
