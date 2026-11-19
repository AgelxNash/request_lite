<script setup>
// Страница настроек: первый раздел — MCP-сервер (design.md D11).
// Параметров ровно два: тумблер включения (по умолчанию выключен) и порт (по умолчанию 45460).
// Токен/адрес/фрагмент конфигурации — не настройки, а блок информации о подключении
// при включённом сервере. Esc или «Закрыть» покидают страницу.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const enabled = ref(false)
const port = ref('45460')
const status = ref(null) // последний ответ mcp:getStatus / mcp:setConfig
const saving = ref(false)
const copied = ref('') // что скопировали последним (для подсказки)
let copiedTimer = null

async function refresh() {
  status.value = await window.api.mcp.getStatus()
  const settings = await window.api.settings.get()
  enabled.value = settings.mcp?.enabled === true
  port.value = String(settings.mcp?.port ?? 45460)
}

watch(
  () => props.visible,
  (open) => {
    if (open) void refresh()
  }
)

// Тумблер применяется сразу: включение генерирует токен и поднимает слушателя,
// выключение закрывает порт (спека: включение/выключение — явное действие).
async function toggleEnabled() {
  saving.value = true
  try {
    status.value = await window.api.mcp.setConfig({ enabled: enabled.value })
  } finally {
    saving.value = false
  }
}

// Порт применяется при выходе из поля или Enter; невалидное значение откатывается.
async function applyPort() {
  const value = Number(port.value)
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    port.value = String(status.value?.port ?? 45460)
    return
  }
  if (value === status.value?.port) return
  saving.value = true
  try {
    status.value = await window.api.mcp.setConfig({ port: value })
  } finally {
    saving.value = false
  }
}

async function regenerateToken() {
  saving.value = true
  try {
    status.value = await window.api.mcp.setConfig({ regenerateToken: true })
  } finally {
    saving.value = false
  }
}

// Готовый фрагмент для вставки в конфигурацию ИИ-клиента (design.md D11).
const clientConfig = computed(() => {
  if (!status.value?.address || !status.value?.token) return ''
  return JSON.stringify(
    {
      mcpServers: {
        'request-lite': {
          url: status.value.address,
          headers: { Authorization: `Bearer ${status.value.token}` }
        }
      }
    },
    null,
    2
  )
})

async function copy(text, what) {
  await window.api.clipboard.write(text)
  copied.value = what
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = ''), 1500)
}

function onDocumentKeydown(event) {
  if (!props.visible || event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  clearTimeout(copiedTimer)
})
</script>

<template>
  <div v-if="visible" class="settings-overlay">
    <div class="settings-page" role="dialog" aria-label="Настройки">
      <header class="settings-header">
        <h2 class="settings-title">Настройки</h2>
        <button class="btn" @click="emit('close')">Закрыть</button>
      </header>

      <section class="settings-section">
        <h3 class="settings-section-title">MCP-сервер</h3>
        <p class="settings-hint">
          Локальный сервер для подключения ИИ-агентов (MCP). Слушает только 127.0.0.1 и закрыт токеном.
        </p>

        <div class="settings-row">
          <span class="settings-row-label">MCP-сервер</span>
          <span class="settings-row-control">
            <input id="mcp-enabled" v-model="enabled" type="checkbox" :disabled="saving" @change="toggleEnabled" />
            <label for="mcp-enabled">Включён</label>
          </span>
        </div>

        <div class="settings-row">
          <span class="settings-row-label">Порт</span>
          <span class="settings-row-control">
            <input
              v-model="port"
              class="dialog-input settings-port-input"
              type="number"
              min="1024"
              max="65535"
              :disabled="saving"
              @blur="applyPort"
              @keydown.enter.prevent="applyPort"
            />
          </span>
        </div>

        <p v-if="status?.state === 'error'" class="settings-status settings-status-error">{{ status.message }}</p>
        <p v-else-if="status?.state === 'running'" class="settings-status settings-status-ok">
          Включён: {{ status.address }}
        </p>
        <p v-else class="settings-status">Выключен</p>

        <div v-if="status?.state === 'running'" class="settings-connection">
          <div class="settings-connection-row">
            <span class="settings-connection-label">Токен</span>
            <code class="settings-connection-value">{{ status.token }}</code>
            <button class="btn" @click="copy(status.token, 'token')">Копировать</button>
            <button class="btn" :disabled="saving" @click="regenerateToken">Перегенерировать</button>
          </div>
          <div class="settings-connection-row">
            <span class="settings-connection-label">Конфиг клиента</span>
            <code class="settings-connection-value settings-config">{{ clientConfig }}</code>
            <button class="btn" @click="copy(clientConfig, 'config')">Копировать</button>
          </div>
          <p v-if="copied" class="settings-hint">
            Скопировано: {{ copied === 'token' ? 'токен' : 'конфигурация клиента' }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
