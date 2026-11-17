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
    }
  }
})
