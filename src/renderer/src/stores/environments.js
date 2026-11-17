import { defineStore } from 'pinia'
import { useProjectsStore } from './projects.js'

// Окружения активного проекта: источник правды — файл проекта (main-процесс).
export const useEnvironmentsStore = defineStore('environments', {
  state: () => ({
    items: [],
    activeId: null,
    loadedProjectId: null
  }),
  actions: {
    async load(projectId) {
      // Повторный load того же проекта пропускаем — иначе in-flight load
      // перезатрёт только что сохранённые окружения (гонка при открытии диалога).
      if (this.loadedProjectId === projectId) return
      if (!projectId) {
        this.items = []
        this.activeId = null
        this.loadedProjectId = null
        return
      }
      const data = await window.api.environments.list(projectId)
      this.items = data.environments
      this.activeId = data.activeEnvId
      this.loadedProjectId = projectId
    },
    async setActive(environmentId) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      const data = await window.api.environments.setActive(projects.activeProjectId, environmentId)
      this.items = data.environments
      this.activeId = data.activeEnvId
    },
    async save(environment) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      this.items = await window.api.environments.save(projects.activeProjectId, environment)
    },
    async remove(environmentId) {
      const projects = useProjectsStore()
      if (!projects.activeProjectId) throw new Error('Нет активного проекта')
      const data = await window.api.environments.delete(projects.activeProjectId, environmentId)
      this.items = data.environments
      this.activeId = data.activeEnvId
    }
  }
})
