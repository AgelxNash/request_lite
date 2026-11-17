<script setup>
import { useProjectsStore } from '../stores/projects.js'
import ProjectList from './ProjectList.vue'

defineEmits(['new-project'])
const projects = useProjectsStore()
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Проекты</span>
      <button class="btn-icon" title="Новый проект" aria-label="Новый проект" @click="$emit('new-project')">
        +
      </button>
    </div>
    <p v-if="projects.error" class="sidebar-error">{{ projects.error }}</p>
    <p v-else-if="projects.loaded && !projects.projects.length" class="sidebar-empty">
      Пока нет проектов.<br />
      Создайте первый:
      <button class="link-btn" @click="$emit('new-project')">+ New Project</button>
    </p>
    <ProjectList v-else @new-project="$emit('new-project')" />
  </aside>
</template>
