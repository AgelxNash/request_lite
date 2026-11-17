<script setup>
import { computed, ref } from 'vue'
import { useTabsStore } from '../stores/tabs.js'
import { escapeHtml, highlightJson, prettyJson } from '../lib/format.js'

const tabs = useTabsStore()
const responseTab = ref('body')

const tab = computed(() => tabs.activeTab)
const response = computed(() => tab.value?.response ?? null)
const error = computed(() => tab.value?.error ?? null)

const ERROR_TITLES = {
  TIMEOUT: 'Таймаут',
  ABORTED: 'Отменено',
  NETWORK: 'Ошибка сети',
  SSL: 'Ошибка SSL-сертификата',
  INVALID_URL: 'Невалидный URL'
}
const errorTitle = computed(() => ERROR_TITLES[error.value?.code] ?? 'Ошибка запроса')

const statusClass = computed(() => {
  const status = response.value?.status ?? 0
  if (status >= 200 && status < 300) return 'status-ok'
  if (status >= 300 && status < 400) return 'status-warn'
  return 'status-err'
})

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${bytes} Б`
}

const isJsonBody = computed(() =>
  (response.value?.headers ?? []).some(
    (h) => h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().includes('json')
  )
)

// JSON показываем pretty + подсветка; если после обреза/ошибки парсинга это не JSON — сырой текст.
const bodyView = computed(() => {
  if (!response.value) return null
  if (isJsonBody.value) {
    const pretty = prettyJson(response.value.body)
    if (pretty !== null) return { html: highlightJson(pretty), kind: 'json' }
  }
  return { html: `<pre class="raw-text">${escapeHtml(response.value.body)}</pre>`, kind: 'raw' }
})
</script>

<template>
  <section class="response-view">
    <div class="response-header">
      <span class="response-title">Ответ</span>
      <template v-if="response">
        <span class="status-pill" :class="statusClass">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span class="meta-pill">{{ response.timeMs }} мс</span>
        <span class="meta-pill">{{ formatSize(response.size) }}</span>
        <span v-if="response.truncated" class="meta-pill warn" title="Тело больше 10 МБ и обрезано">
          обрезано
        </span>
      </template>
    </div>

    <!-- Ошибка отправки: таймаут, отмена, сеть, SSL, невалидный URL -->
    <div v-if="error" class="response-error" :class="{ aborted: error.code === 'ABORTED' }">
      <strong>{{ errorTitle }}</strong>
      <span>{{ error.message }}</span>
    </div>

    <!-- Ответ -->
    <template v-else-if="response">
      <div class="response-tabs-row">
        <button
          class="request-tab"
          :class="{ active: responseTab === 'body' }"
          @click="responseTab = 'body'"
        >
          Тело
        </button>
        <button
          class="request-tab"
          :class="{ active: responseTab === 'headers' }"
          @click="responseTab = 'headers'"
        >
          Заголовки
        </button>
      </div>
      <div class="response-content">
        <!-- eslint-disable-next-line vue/no-v-html — подсветка экранирует каждый токен (format.js) -->
        <div v-if="responseTab === 'body'" class="code-view" v-html="bodyView?.html"></div>
        <div v-else class="kv-table response-headers">
          <div v-for="(header, index) in response.headers" :key="index" class="kv-row">
            <span class="resp-header-key">{{ header.key }}</span>
            <span class="resp-header-value">{{ header.value }}</span>
          </div>
          <p v-if="!response.headers.length" class="kv-empty">Заголовков нет</p>
        </div>
      </div>
    </template>

    <!-- Пустое состояние -->
    <div v-else class="response-empty">Отправьте запрос, чтобы увидеть ответ</div>
  </section>
</template>
