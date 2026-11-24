import { defineStore } from 'pinia'

// Мок-сервер: мок-проекты, конфигурация активного, статус слушателя и журнал.
// Ответ main — истина; сбой мутации → ресинк с диском (как в projects.js).
export const useMocksStore = defineStore('mocks', {
  state: () => ({
    projects: [],
    activeProjectId: null,
    loaded: false,
    error: null,
    // Конфигурация активного мок-проекта с диска: {routes, defaultResponse}.
    // Редактор работает с локальной копией и сохраняет целиком через saveConfig.
    config: { routes: [], defaultResponse: null },
    // Статус слушателя из main: {state: stopped|running|error, message, port, projectId, defaultPort}.
    status: { state: 'stopped', message: '', port: null, projectId: null, defaultPort: 4547 },
    log: []
  }),
  getters: {
    activeProject: (state) => state.projects.find((p) => p.id === state.activeProjectId) ?? null
  },
  actions: {
    async load() {
      try {
        this.projects = await window.api.mocks.listProjects()
        this.error = null
      } catch (error) {
        this.error = error?.message ?? 'Не удалось загрузить мок-проекты'
      } finally {
        this.loaded = true
        if (!this.activeProjectId && this.projects.length) {
          await this.select(this.projects[0].id)
        }
      }
    },
    async refreshStatus() {
      try {
        this.status = await window.api.mocks.getStatus()
      } catch (error) {
        console.error('Не удалось получить статус мок-сервера:', error)
      }
    },
    async select(id) {
      this.activeProjectId = id
      try {
        const config = await window.api.mocks.getProject(id)
        this.config = config ?? { routes: [], defaultResponse: null }
      } catch (error) {
        console.error('Не удалось загрузить конфигурацию мок-проекта:', error)
      }
    },
    async create(name) {
      const project = await window.api.mocks.createProject(name)
      this.projects.push(project)
      this.activeProjectId = project.id
      this.config = { routes: [], defaultResponse: null }
      return project
    },
    async rename(id, name) {
      const updated = await window.api.mocks.renameProject(id, name)
      const index = this.projects.findIndex((p) => p.id === id)
      if (index !== -1) this.projects[index] = updated
      return updated
    },
    async remove(id) {
      try {
        await window.api.mocks.deleteProject(id)
        this.projects = this.projects.filter((p) => p.id !== id)
        if (this.activeProjectId === id) {
          this.activeProjectId = this.projects[0]?.id ?? null
          if (this.activeProjectId) await this.select(this.activeProjectId)
          else this.config = { routes: [], defaultResponse: null }
        }
      } catch (error) {
        // Мок-проект мог быть удалён из другого места — синхронизируем список с диском
        console.error('Не удалось удалить мок-проект:', error)
        await this.load()
      }
    },
    // Сохранение конфигурации целиком; запущенный на этом мок-проекте сервер
    // применяет её на лету (main делает это в mocks:saveProject).
    async saveConfig(config) {
      const stored = await window.api.mocks.saveProject(this.activeProjectId, config)
      this.config = stored
      return stored
    },
    // Старт не бросает: занятый/невалидный порт приходит как статус {state:'error'}.
    async start(port) {
      this.status = await window.api.mocks.start(this.activeProjectId, port)
      return this.status
    },
    async stop() {
      this.status = await window.api.mocks.stop()
      return this.status
    },
    async loadLog() {
      try {
        this.log = await window.api.mocks.getLog()
      } catch (error) {
        console.error('Не удалось загрузить журнал мок-сервера:', error)
      }
    },
    async clearLog() {
      try {
        await window.api.mocks.clearLog()
        this.log = []
      } catch (error) {
        console.error('Не удалось очистить журнал мок-сервера:', error)
      }
    },
    appendLog(entry) {
      this.log.push(entry)
      // Буфер main ограничен 500 — зеркало тот же лимит, старые вытесняются.
      if (this.log.length > 500) this.log.shift()
    }
  }
})
