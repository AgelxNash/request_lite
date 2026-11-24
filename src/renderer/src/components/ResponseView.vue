<script setup>
import { computed, ref, watch } from 'vue'
import { useTabsStore } from '../stores/tabs.js'
import { escapeHtml, highlightJson, prettyJson } from '../lib/format.js'

const tabs = useTabsStore()
const mode = ref('live') // 'live' — текущий ответ вкладки, 'history' — записи с диска
const selectedHistoryIndex = ref(0)
const responseTab = ref('body')

const tab = computed(() => tabs.activeTab)
const response = computed(() => tab.value?.response ?? null)
const error = computed(() => tab.value?.error ?? null)
const historyEntries = computed(() => tab.value?.history ?? [])
const historyError = computed(() => tab.value?.historyError ?? false)
const selectedEntry = computed(() => historyEntries.value[selectedHistoryIndex.value] ?? null)

// В шапке и в содержании показывается один «активный» ответ: живой — в live-режиме,
// выбранная запись — в истории.
const displayResponse = computed(() =>
  mode.value === 'history' ? selectedEntry.value?.response ?? null : response.value
)

// Новая вкладка, новая отправка или подгруженный последний ответ сбрасывают вид на «Последний».
watch([() => tab.value?.id, () => tab.value?.response], () => {
  mode.value = 'live'
  selectedHistoryIndex.value = 0
})

function switchToHistory() {
  mode.value = 'history'
  selectedHistoryIndex.value = 0
}

const ERROR_TITLES = {
  TIMEOUT: 'Таймаут',
  ABORTED: 'Отменено',
  NETWORK: 'Ошибка сети',
  SSL: 'Ошибка SSL-сертификата',
  INVALID_URL: 'Невалидный URL'
}
const errorTitle = computed(() => ERROR_TITLES[error.value?.code] ?? 'Ошибка запроса')

function statusClass(resp) {
  const status = resp?.status ?? 0
  if (status >= 200 && status < 300) return 'status-ok'
  if (status >= 300 && status < 400) return 'status-warn'
  return 'status-err'
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${bytes} Б`
}

function formatTime(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}

function isJsonBody(resp) {
  return (resp?.headers ?? []).some(
    (h) => h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().includes('json')
  )
}

// JSON показываем pretty + подсветка; если после обреза/ошибки парсинга это не JSON — сырой текст.
function renderBody(resp) {
  if (!resp) return null
  if (isJsonBody(resp)) {
    const pretty = prettyJson(resp.body)
    if (pretty !== null) return { html: highlightJson(pretty), kind: 'json' }
  }
  return { html: `<pre class="raw-text">${escapeHtml(resp.body)}</pre>`, kind: 'raw' }
}

const bodyView = computed(() => renderBody(displayResponse.value))
</script>

<template>
  <section class="response-view">
    <div class="response-header">
      <span class="response-title">Ответ</span>
      <template v-if="displayResponse">
        <span class="status-pill" :class="statusClass(displayResponse)">
          {{ displayResponse.status }} {{ displayResponse.statusText }}
        </span>
        <span class="meta-pill">{{ displayResponse.timeMs }} мс</span>
        <span class="meta-pill">{{ formatSize(displayResponse.size) }}</span>
        <span v-if="displayResponse.truncated" class="meta-pill warn" title="Тело больше 10 МБ и обрезано">
          обрезано
        </span>
        <span v-if="displayResponse.bodyCut" class="meta-pill warn" title="В истории тело урезано до 100 КБ">
          тело урезано
        </span>
        <span v-if="displayResponse.binary" class="meta-pill warn" title="Бинарное тело не сохраняется">
          бинарное
        </span>
        <span
          v-if="mode === 'live' && response.fromHistory"
          class="meta-pill"
          title="Последний сохранённый ответ — виден до новой отправки"
        >
          из истории · {{ formatTime(response.receivedAt) }}
        </span>
      </template>
      <div class="response-mode-switch">
        <button class="request-tab" :class="{ active: mode === 'live' }" @click="mode = 'live'">
          Последний
        </button>
        <button class="request-tab" :class="{ active: mode === 'history' }" @click="switchToHistory">
          История
        </button>
      </div>
    </div>

    <!-- Последний ответ: ошибка отправки (таймаут, отмена, сеть, SSL, невалидный URL) -->
    <template v-if="mode === 'live'">
      <div v-if="error" class="response-error" :class="{ aborted: error.code === 'ABORTED' }">
        <strong>{{ errorTitle }}</strong>
        <span>{{ error.message }}</span>
      </div>

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
    </template>

    <!-- История: записи с диска, переключение и выбор не отправляют запросы -->
    <template v-else>
      <div v-if="historyError" class="response-empty">
        История недоступна: файл истории повреждён
      </div>
      <div v-else-if="!historyEntries.length" class="response-empty">
        История пуста — отправьте запрос
      </div>
      <template v-else-if="selectedEntry">
        <div class="history-list">
          <button
            v-for="(entry, index) in historyEntries"
            :key="entry.createdAt + index"
            class="history-item"
            :class="{ active: index === selectedHistoryIndex }"
            @click="selectedHistoryIndex = index"
          >
            <span class="history-time">{{ formatTime(entry.createdAt) }}</span>
            <span class="status-pill status-pill-mini" :class="statusClass(entry.response)">
              {{ entry.response.status }}
            </span>
            <span class="history-ms">{{ entry.response.timeMs }} мс</span>
          </button>
        </div>
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
          <div v-if="responseTab === 'body'" class="history-body">
            <!-- eslint-disable-next-line vue/no-v-html — подсветка экранирует каждый токен (format.js) -->
            <div v-if="displayResponse.binary" class="response-empty">Бинарное тело не сохранено</div>
            <!-- eslint-disable-next-line vue/no-v-html — подсветка экранирует каждый токен (format.js) -->
            <div v-else-if="bodyView" class="code-view" v-html="bodyView.html"></div>
          </div>
          <div v-else class="kv-table response-headers">
            <div v-for="(header, index) in displayResponse.headers" :key="index" class="kv-row">
              <span class="resp-header-key">{{ header.key }}</span>
              <span class="resp-header-value">{{ header.value }}</span>
            </div>
            <p v-if="!displayResponse.headers.length" class="kv-empty">Заголовков нет</p>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
