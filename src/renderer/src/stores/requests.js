import { defineStore } from 'pinia'
import { useProjectsStore } from './projects.js'

// Запросы активного проекта: источник правды — файл проекта (main-процесс),
// методы возвращают обновлённый список, чтобы store не расходился с диском.
export const useRequestsStore = defineStore('requests', {
  state: () => ({
    items: [],
    loadedProjectId: null
  }),
  actions: {
    async load(projectId) {
      if (!projectId) {
        this.items = []
        this.loadedProjectId = null
        return
      }
      this.items = await window.api.requests.list(projectId)
      this.loadedProjectId = projectId
    },
    async save(request) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      this.items = await window.api.requests.save(projects.activeProjectId, request)
    },
    async remove(requestId) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      this.items = await window.api.requests.delete(projects.activeProjectId, requestId)
    },
    // Блокировка запроса (защита от обновления и удаления). Ответ main — обновлённый список.
    async setLocked(requestId, locked) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      this.items = await window.api.requests.setLocked(projects.activeProjectId, requestId, locked)
    },
    // Закрепление запроса (верхняя зона списка). Ответ main — нормализованный список.
    async setPinned(requestId, pinned) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      this.items = await window.api.requests.setPinned(projects.activeProjectId, requestId, pinned)
    },
    // Перемещение запроса в списке проекта. Во время drag порядок уже менялся
    // локально (moveLocal); здесь один IPC на завершение жеста — одна атомарная
    // запись на диск. Сбой/откат — перечитываем состояние диска.
    moveLocal(requestId, toIndex) {
      const from = this.items.findIndex((r) => r.id === requestId)
      if (from === -1) return
      // Дублирующая защита зоны pin: честные зоны во время drag, IPC-ответ — истина.
      const pinnedCount = this.items.filter((r) => r.pinned === true).length
      const lower = this.items[from].pinned === true ? 0 : pinnedCount
      const upper = this.items[from].pinned === true ? pinnedCount - 1 : this.items.length - 1
      const to = Math.max(lower, Math.min(toIndex, upper))
      if (to === from) return
      const [moved] = this.items.splice(from, 1)
      this.items.splice(to, 0, moved)
    },
    async reorder(requestId, toIndex) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      try {
        this.items = await window.api.requests.reorder(projects.activeProjectId, requestId, toIndex)
      } catch (error) {
        console.error('Не удалось сохранить порядок запросов:', error)
        await this.load(projects.activeProjectId)
      }
    }
  }
})
