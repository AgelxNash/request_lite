import { defineStore } from 'pinia'

// Тема интерфейса: тёмная (по умолчанию) и светлая.
// Значение применяется через data-theme на <html>; цвета описаны CSS-переменными в style.css.
export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: 'dark'
  }),
  actions: {
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
