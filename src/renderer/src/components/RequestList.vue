<script setup>
import { inject, onMounted, watch } from 'vue'
import { useProjectsStore } from '../stores/projects.js'
import { useRequestsStore } from '../stores/requests.js'
import { useTabsStore } from '../stores/tabs.js'

const projects = useProjectsStore()
const requests = useRequestsStore()
const tabs = useTabsStore()
const dialog = inject('dialog')

// Список живёт по активному проекту: первичная загрузка и реакция на переключение.
onMounted(() => requests.load(projects.activeProjectId))
watch(
  () => projects.activeProjectId,
  (id) => requests.load(id)
)

function open(request) {
  tabs.openSaved(request)
}

async function remove(request) {
  const confirmed = await dialog.value.confirm({
    title: 'Удалить запрос',
    message: `Удалить запрос «${request.name}» из проекта?`,
    confirmText: 'Удалить'
  })
  if (!confirmed) return
  await requests.remove(request.id)
  // Открытые вкладки этого запроса отвязываются, оставаясь открытыми.
  tabs.detachSaved(request.id)
}
</script>

<template>
  <div class="request-section">
    <div class="sidebar-header">
      <span class="sidebar-title">Запросы</span>
    </div>
    <p v-if="!requests.items.length" class="sidebar-empty">
      Нет сохранённых запросов.<br />Заполните вкладку и нажмите Save.
    </p>
    <ul v-else class="request-list">
      <li
        v-for="request in requests.items"
        :key="request.id"
        class="project-item request-item"
        :title="request.name"
        @click="open(request)"
      >
        <span class="item-method" :class="`method-${request.method}`">{{ request.method }}</span>
        <span class="project-name">{{ request.name }}</span>
        <span class="project-actions">
          <button
            class="btn-icon btn-icon-danger"
            title="Удалить запрос"
            aria-label="Удалить запрос"
            @click.stop="remove(request)"
          >
            ✕
          </button>
        </span>
      </li>
    </ul>
  </div>
</template>
