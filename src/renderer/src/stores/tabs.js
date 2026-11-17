import { defineStore } from 'pinia'

let nextTabId = 1

function makeTab() {
  return { id: nextTabId++, name: 'Untitled Request', method: 'GET', url: '' }
}

// Вкладки открытых запросов. В каркасе вкладка — локальный стейт (метод, URL, имя);
// сохранение запросов появится в следующем изменении.
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
      // В каркасе всегда есть хотя бы одна вкладка — при закрытии последней открывается новая пустая.
      if (!this.tabs.length) this.openTab()
    },
    setActive(id) {
      this.activeTabId = id
    },
    updateActive(patch) {
      const tab = this.activeTab
      if (tab) Object.assign(tab, patch)
    }
  }
})
