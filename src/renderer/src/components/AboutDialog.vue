<script setup>
// Окно «О приложении»: имя, версия, описание, автор, Telegram-ссылка (кликабельная).
// Esc закрывает (вспомогательное окно — отмена), Enter не перехватывается.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const TELEGRAM_URL = 'https://t.me/nikolaenkov_roman'

const version = ref('')

function onDocumentKeydown(event) {
  if (!props.visible || event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

watch(
  () => props.visible,
  (open) => {
    if (open) window.api.app.version().then((v) => (version.value = v))
  }
)

async function openTelegram() {
  await window.api.shell.openExternal(TELEGRAM_URL)
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @mousedown.self="emit('close')">
    <div class="dialog about-dialog" role="dialog" aria-label="О приложении">
      <h2 class="about-name"><span class="brand-accent">Request</span> Lite</h2>
      <p class="about-version">Version {{ version }}</p>
      <p class="about-description">Программа для тестирования запросов</p>
      <p class="about-author">Автор: Roman Nikolaenkov</p>
      <a href="#" class="link-btn about-link" @click.prevent="openTelegram">Telegram</a>
      <div class="dialog-actions">
        <button class="btn btn-primary" @click="emit('close')">Закрыть</button>
      </div>
    </div>
  </div>
</template>
