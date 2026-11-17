import { defineStore } from 'pinia'

// Проекты: CRUD через window.api (IPC в main-процесс, JSON-файлы на диске).
export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    activeProjectId: null,
    loaded: false,
    error: null
  }),
  getters: {
    activeProject: (state) => state.projects.find((p) => p.id === state.activeProjectId) ?? null
  },
  actions: {
    async load() {
      try {
        this.projects = await window.api.projects.list()
        this.error = null
      } catch (error) {
        this.error = error?.message ?? 'Не удалось загрузить проекты'
      } finally {
        this.loaded = true
        if (!this.activeProjectId && this.projects.length) {
          this.activeProjectId = this.projects[0].id
        }
      }
    },
    async create(name) {
      const project = await window.api.projects.create(name)
      this.projects.push(project)
      this.activeProjectId = project.id
      return project
    },
    async rename(id, name) {
      const updated = await window.api.projects.rename(id, name)
      const index = this.projects.findIndex((p) => p.id === id)
      if (index !== -1) this.projects[index] = updated
      return updated
    },
    // Блокировка проекта (защита от удаления). Ответ main — обновлённая запись.
    async setLocked(id, locked) {
      const updated = await window.api.projects.setLocked(id, locked)
      const index = this.projects.findIndex((p) => p.id === id)
      if (index !== -1) this.projects[index] = updated
      return updated
    },
    async remove(id) {
      try {
        await window.api.projects.delete(id)
        this.projects = this.projects.filter((p) => p.id !== id)
        if (this.activeProjectId === id) {
          this.activeProjectId = this.projects[0]?.id ?? null
        }
      } catch (error) {
        // Проект мог быть удалён из другого места — синхронизируем список с диском
        console.error('Не удалось удалить проект:', error)
        await this.load()
      }
    },
    // Bulk-импорт коллекции Postman: main создаёт проект, store обновляется из ответа.
    async importCollection(payload) {
      const project = await window.api.projects.importCollection(payload)
      await this.load()
      this.activeProjectId = project.id
      return project
    },
    select(id) {
      this.activeProjectId = id
    }
  }
})
