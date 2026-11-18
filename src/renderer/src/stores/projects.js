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
    // Закрепление проекта (верхняя зона списка). Ответ main — нормализованный список.
    async setPinned(id, pinned) {
      this.projects = await window.api.projects.setPinned(id, pinned)
    },
    // Перемещение проекта в списке. Во время drag порядок уже менялся локально
    // (moveLocal); здесь один IPC на завершение жеста — одна атомарная запись индекса.
    // Сбой/откат — перечитываем состояние диска. Активный проект не зависит от порядка.
    moveLocal(id, toIndex) {
      const from = this.projects.findIndex((p) => p.id === id)
      if (from === -1) return
      // Дублирующая защита зоны pin: честные зоны во время drag, IPC-ответ — истина.
      const pinnedCount = this.projects.filter((p) => p.pinned === true).length
      const lower = this.projects[from].pinned === true ? 0 : pinnedCount
      const upper = this.projects[from].pinned === true ? pinnedCount - 1 : this.projects.length - 1
      const to = Math.max(lower, Math.min(toIndex, upper))
      if (to === from) return
      const [moved] = this.projects.splice(from, 1)
      this.projects.splice(to, 0, moved)
    },
    async reorder(id, toIndex) {
      try {
        this.projects = await window.api.projects.reorder(id, toIndex)
      } catch (error) {
        console.error('Не удалось сохранить порядок проектов:', error)
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
