import { defineStore } from 'pinia'

let nextTabId = 1
let nextRowId = 1

// Строка KV-таблицы (params/headers/form/urlencoded).
function makeRow(key = '', value = '') {
  return { id: nextRowId++, key, value, enabled: true }
}

function makeTab() {
  return {
    id: nextTabId++,
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    params: [makeRow()],
    headers: [makeRow()],
    body: { type: 'none', json: '', form: [makeRow()], urlencoded: [makeRow()], text: '' },
    auth: { type: 'none', token: '', username: '', password: '', key: '', value: '', placement: 'header' },
    sslVerify: true,
    // Runtime-состояние (не часть модели запроса): отправка и последний результат.
    sending: false,
    requestId: null,
    response: null,
    error: null
  }
}

// Плоский снимок для IPC: реактивные Proxy не сериализуются через invoke.
function toSnapshot(tab) {
  return JSON.parse(
    JSON.stringify({
      name: tab.name,
      method: tab.method,
      url: tab.url,
      params: tab.params,
      headers: tab.headers,
      body: tab.body,
      auth: tab.auth,
      sslVerify: tab.sslVerify
    })
  )
}

// Вкладки открытых запросов. Полная модель запроса (params/headers/body/auth/ssl);
// сохранение запросов в проект появится в отдельном изменении.
export const useTabsStore = defineStore('tabs', {
  state: () => ({
    tabs: [],
    activeTabId: null
  }),
  getters: {
    activeTab: (state) => state.tabs.find((t) => t.id === state.activeTabId) ?? null
  },
  actions: {
    openTab() {
      const tab = makeTab()
      this.tabs.push(tab)
      this.activeTabId = tab.id
      return tab
    },
    // Стартовая вкладка при запуске приложения.
    openStartTab() {
      if (!this.tabs.length) this.openTab()
    },
    closeTab(id) {
      const index = this.tabs.findIndex((t) => t.id === id)
      if (index === -1) return
      this.tabs.splice(index, 1)
      if (this.activeTabId === id) {
        const next = this.tabs[index] ?? this.tabs[index - 1]
        this.activeTabId = next?.id ?? null
      }
      // При закрытии последней вкладки открывается новая пустая.
      if (!this.tabs.length) this.openTab()
    },
    setActive(id) {
      this.activeTabId = id
    },
    updateActive(patch) {
      const tab = this.activeTab
      if (tab) Object.assign(tab, patch)
    },
    updateActiveBody(patch) {
      const tab = this.activeTab
      if (tab) Object.assign(tab.body, patch)
    },
    updateActiveAuth(patch) {
      const tab = this.activeTab
      if (tab) Object.assign(tab.auth, patch)
    },
    // Отправка активного запроса; ответ привязывается к вкладке (не к активной).
    async sendActive() {
      const tab = this.activeTab
      if (!tab || tab.sending || !tab.url.trim()) return
      tab.sending = true
      tab.response = null
      tab.error = null
      try {
        const requestId = crypto.randomUUID()
        tab.requestId = requestId
        const result = await window.api?.http.send(requestId, toSnapshot(tab))
        if (!result) {
          tab.error = { code: 'NETWORK', message: 'Мост main-процесса недоступен' }
          return
        }
        if (result.ok) tab.response = result.response
        else tab.error = result.error
      } catch (err) {
        tab.error = { code: 'NETWORK', message: String(err?.message ?? err) }
      } finally {
        tab.sending = false
      }
    },
    // Отмена выполняющегося запроса вкладки.
    cancelTab(id) {
      const tab = this.tabs.find((t) => t.id === id)
      if (tab?.requestId) window.api?.http.cancel(tab.requestId)
    }
  }
})
