import { defineStore } from 'pinia'
import { DEFAULT_HEADERS } from '../lib/defaults.js'
import { suggestRequestName } from '../lib/request-name.js'
import { useProjectsStore } from './projects.js'
import { useRequestsStore } from './requests.js'

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
    // Стандартные заголовки (включённые, перекрывают автозначения undici) + пустая строка.
    headers: [...DEFAULT_HEADERS.map((h) => ({ ...h, id: nextRowId++ })), makeRow()],
    body: { type: 'none', json: '', form: [makeRow()], urlencoded: [makeRow()], text: '' },
    auth: { type: 'none', token: '', username: '', password: '', key: '', value: '', placement: 'header' },
    sslVerify: true,
    // Связь с сохранённым запросом (id в файле проекта) и признак несохранённых правок.
    savedRequestId: null,
    dirty: false,
    // Runtime-состояние (не часть модели запроса): отправка и последний результат.
    sending: false,
    requestId: null,
    response: null,
    error: null
  }
}

// Полностью пустые строки (нет ни ключа, ни значения) не попадают в снимок —
// иначе каждый цикл «сохранить → открыть» добавлял бы по пустой строке.
function meaningfulRows(rows) {
  return (rows ?? []).filter(
    (row) => String(row.key ?? '') !== '' || String(row.value ?? '') !== ''
  )
}

// Плоский снимок для IPC: реактивные Proxy не сериализуются через invoke.
function toSnapshot(tab) {
  const body = tab.body ?? { type: 'none' }
  return JSON.parse(
    JSON.stringify({
      name: tab.name,
      method: tab.method,
      url: tab.url,
      params: meaningfulRows(tab.params),
      headers: meaningfulRows(tab.headers),
      body: { ...body, form: meaningfulRows(body.form), urlencoded: meaningfulRows(body.urlencoded) },
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
      if (tab) {
        Object.assign(tab, patch)
        tab.dirty = true
      }
    },
    updateActiveBody(patch) {
      const tab = this.activeTab
      if (tab) {
        Object.assign(tab.body, patch)
        tab.dirty = true
      }
    },
    updateActiveAuth(patch) {
      const tab = this.activeTab
      if (tab) {
        Object.assign(tab.auth, patch)
        tab.dirty = true
      }
    },
    // Открывает сохранённый запрос в новой вкладке: снимок + связь с сохранённым.
    openSaved(request) {
      const tab = makeTab()
      const cloneRows = (rows) => (rows ?? []).map((row) => ({ ...row }))
      Object.assign(tab, {
        name: request.name,
        method: request.method ?? 'GET',
        url: request.url ?? '',
        params: [...cloneRows(request.params), makeRow()],
        headers: [...cloneRows(request.headers), makeRow()],
        body: JSON.parse(JSON.stringify(request.body ?? { type: 'none' })),
        auth: { type: 'none', ...(request.auth ?? {}) },
        sslVerify: request.sslVerify !== false,
        savedRequestId: request.id
      })
      this.tabs.push(tab)
      this.activeTabId = tab.id
      return tab
    },
    // Сохранение активной вкладки (обёртка для кнопки Save и меню CmdOrCtrl+S).
    async saveActiveViaDialog(dialog) {
      return this.saveTab(this.activeTabId, dialog)
    },
    // Сохранение конкретной вкладки в активный проект. При первом сохранении
    // запрашивает имя (диалог с подсказкой), повторное обновляет связанный запрос молча.
    async saveTab(id, dialog) {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.sending) return false
      const projects = useProjectsStore()
      if (!projects.activeProjectId) return false
      const requests = useRequestsStore()
      let name = tab.name
      if (!tab.savedRequestId) {
        // Подсказка: переименованная вкладка — её имя, иначе имя из URL.
        const suggested =
          tab.name !== 'Untitled Request' ? tab.name : suggestRequestName(tab.url) || 'Untitled Request'
        const entered = await dialog.prompt({
          title: 'Сохранить запрос',
          label: 'Имя запроса',
          value: suggested,
          confirmText: 'Сохранить'
        })
        if (!entered) return false // отмена или пустое имя
        name = entered.trim() || suggested
      }
      const request = { id: tab.savedRequestId ?? crypto.randomUUID(), ...toSnapshot(tab), name }
      requests.items = await window.api.requests.save(projects.activeProjectId, request)
      tab.savedRequestId = request.id
      tab.name = name
      tab.dirty = false
      return true
    },
    // Клон вкладки: копия содержимого без связи с сохранённым запросом.
    // Первый Save клона создаёт новый запрос (upsert по savedRequestId: null).
    cloneTab(id) {
      const source = this.tabs.find((t) => t.id === id)
      if (!source) return null
      const snapshot = toSnapshot(source)
      const cloneRows = (rows) => (rows ?? []).map((row) => ({ ...row }))
      const tab = makeTab()
      Object.assign(tab, {
        name: `${snapshot.name} (копия)`,
        method: snapshot.method,
        url: snapshot.url,
        params: [...cloneRows(snapshot.params), makeRow()],
        headers: [...cloneRows(snapshot.headers), makeRow()],
        body: JSON.parse(JSON.stringify(snapshot.body)),
        auth: { type: 'none', ...snapshot.auth },
        sslVerify: snapshot.sslVerify !== false,
        savedRequestId: null,
        dirty: false
      })
      this.tabs.push(tab)
      this.activeTabId = tab.id
      return tab
    },
    // Отвязывает вкладки от удалённого запроса: содержимое остаётся, связь исчезает.
    detachSaved(requestId) {
      for (const tab of this.tabs) {
        if (tab.savedRequestId === requestId) {
          tab.savedRequestId = null
          tab.dirty = false
        }
      }
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
