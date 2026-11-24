import { defineStore } from 'pinia'

// Тема интерфейса: тёмная (по умолчанию) и светлая.
// Значение применяется через data-theme на <html>; цвета описаны CSS-переменными в style.css.
// view — вид основной области: 'requests' (редактор запросов) | 'mocks' (мок-сервер).
// Runtime-состояние сессии: в settings не сохраняется, при перезапуске — «Запросы».
export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: 'dark',
    view: 'requests'
  }),
  actions: {
    setView(view) {
      this.view = view === 'mocks' ? 'mocks' : 'requests'
    },
    applyInitialTheme(settings) {
      this.theme = settings?.theme === 'light' ? 'light' : 'dark'
      this.applyToDom()
    },
    async toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      this.applyToDom()
      try {
        await window.api.settings.set({ theme: this.theme })
      } catch (error) {
        console.error('Не удалось сохранить тему:', error)
      }
    },
    applyToDom() {
      document.documentElement.dataset.theme = this.theme
    }
  }
})
