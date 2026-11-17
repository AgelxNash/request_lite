<script setup>
// Диалог импорта запроса из команды curl: textarea + парсинг → новая вкладка.
import { ref, watch } from 'vue'
import { parseCurl } from '../lib/curl.js'
import { useTabsStore } from '../stores/tabs.js'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const tabs = useTabsStore()
const command = ref('')
const error = ref(null)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      command.value = ''
      error.value = null
    }
  }
)

function submit() {
  try {
    const snapshot = parseCurl(command.value)
    tabs.openTabFromSnapshot(snapshot)
    emit('close')
  } catch (err) {
    error.value = err?.message ?? 'Не удалось разобрать команду'
  }
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @mousedown.self="emit('close')">
    <div class="dialog curl-import-dialog" role="dialog" aria-label="Импорт из cURL">
      <h3 class="dialog-title">Вставить запрос из cURL</h3>
      <p class="dialog-message">Вставьте команду curl — запрос откроется в новой вкладке.</p>
      <textarea
        v-model="command"
        class="curl-import-textarea"
        rows="7"
        spellcheck="false"
        placeholder="curl -X POST 'https://api.example.com' -H 'Content-Type: application/json' -d '{...}'"
        @keydown.esc.prevent="emit('close')"
      ></textarea>
      <p v-if="error" class="curl-import-error">{{ error }}</p>
      <div class="dialog-actions">
        <button class="btn" @click="emit('close')">Отмена</button>
        <button class="btn btn-primary" :disabled="!command.trim()" @click="submit">Импорт</button>
      </div>
    </div>
  </div>
</template>
