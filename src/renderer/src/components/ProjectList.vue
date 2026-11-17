<script setup>
import { inject } from 'vue'
import { useProjectsStore } from '../stores/projects.js'

const projects = useProjectsStore()
const dialog = inject('dialog')

async function rename(project) {
  const name = await dialog.value.prompt({
    title: 'Переименовать проект',
    label: 'Имя проекта',
    value: project.name,
    confirmText: 'Переименовать'
  })
  if (name === null || name === project.name) return
  await projects.rename(project.id, name)
}

async function toggleLock(project) {
  const locking = project.locked !== true
  const confirmed = await dialog.value.confirm({
    title: locking ? 'Заблокировать проект' : 'Разблокировать проект',
    message: locking
      ? `Заблокировать проект «${project.name}»? Его нельзя будет удалить до разблокировки.`
      : `Разблокировать проект «${project.name}»?`,
    confirmText: locking ? 'Заблокировать' : 'Разблокировать'
  })
  if (!confirmed) return
  await projects.setLocked(project.id, locking)
}

async function remove(project) {
  if (project.locked === true) return
  const confirmed = await dialog.value.confirm({
    title: 'Удалить проект',
    message: `Удалить проект «${project.name}»? Его запросы и окружения будут потеряны.`,
    confirmText: 'Удалить'
  })
  if (confirmed) await projects.remove(project.id)
}
</script>

<template>
  <ul class="project-list">
    <li
      v-for="project in projects.projects"
      :key="project.id"
      class="project-item"
      :class="{ active: project.id === projects.activeProjectId }"
      @click="projects.select(project.id)"
    >
      <span class="project-name" :title="project.name">
        <span v-if="project.locked === true" class="project-lock-badge" title="Проект заблокирован">🔒</span>
        {{ project.name }}
      </span>
      <span class="project-actions">
        <button
          class="btn-icon"
          :title="project.locked === true ? 'Разблокировать проект' : 'Заблокировать проект'"
          :aria-label="project.locked === true ? 'Разблокировать проект' : 'Заблокировать проект'"
          @click.stop="toggleLock(project)"
        >
          {{ project.locked === true ? '🔒' : '🔓' }}
        </button>
        <button
          class="btn-icon"
          title="Переименовать"
          aria-label="Переименовать проект"
          @click.stop="rename(project)"
        >
          ✎
        </button>
        <button
          class="btn-icon btn-icon-danger"
          :disabled="project.locked === true"
          :title="project.locked === true ? 'Проект заблокирован' : 'Удалить'"
          aria-label="Удалить проект"
          @click.stop="remove(project)"
        >
          ✕
        </button>
      </span>
    </li>
  </ul>
</template>
