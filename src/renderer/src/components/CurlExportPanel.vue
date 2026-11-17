<script setup>
// Панель-шторка экспорта: команда curl в код-блоке, «Копировать» в системный буфер.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  text: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const copied = ref(false)

function copy() {
  window.api.clipboard.write(props.text).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  })
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.visible) emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside v-if="visible" class="curl-panel">
    <div class="curl-panel-header">
      <span class="curl-panel-title">cURL</span>
      <span class="toolbar-right">
        <button class="btn" @click="copy">{{ copied ? 'Скопировано ✓' : 'Копировать' }}</button>
        <button class="btn-icon" title="Закрыть" aria-label="Закрыть панель" @click="emit('close')">
          ×
        </button>
      </span>
    </div>
    <pre class="curl-code">{{ text }}</pre>
  </aside>
</template>
