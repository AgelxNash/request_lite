<script setup>
import { onMounted, ref, watch } from 'vue'
import { useEnvironmentsStore } from '../stores/environments.js'
import { useProjectsStore } from '../stores/projects.js'
import { useUiStore } from '../stores/ui.js'
import EnvironmentsDialog from './EnvironmentsDialog.vue'

const ui = useUiStore()
const projects = useProjectsStore()
const environments = useEnvironmentsStore()
const manageVisible = ref(false)

// Список и активный выбор живут по активному проекту.
onMounted(() => environments.load(projects.activeProjectId))
watch(
  () => projects.activeProjectId,
  (id) => environments.load(id)
)

function select(event) {
  environments.setActive(event.target.value === '' ? null : event.target.value)
}
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-brand"><span class="brand-accent">Request</span> Lite</div>
    <div class="toolbar-center">
      <div class="view-switch" role="tablist" aria-label="Вид приложения">
        <button
          class="view-switch-btn"
          :class="{ active: ui.view === 'requests' }"
          role="tab"
          :aria-selected="ui.view === 'requests'"
          @click="ui.setView('requests')"
        >
          Запросы
        </button>
        <button
          class="view-switch-btn"
          :class="{ active: ui.view === 'mocks' }"
          role="tab"
          :aria-selected="ui.view === 'mocks'"
          @click="ui.setView('mocks')"
        >
          Мок-сервер
        </button>
      </div>
      <select
        class="env-select"
        :value="environments.activeId ?? ''"
        aria-label="Активное окружение"
        @change="select"
      >
        <option value="">No Environment</option>
        <option v-for="environment in environments.items" :key="environment.id" :value="environment.id">
          {{ environment.name }}
        </option>
      </select>
      <button
        class="btn-icon"
        title="Управление окружениями"
        aria-label="Управление окружениями"
        @click="manageVisible = true"
      >
        ⚙
      </button>
    </div>
    <div class="toolbar-right">
      <button
        class="btn-icon"
        :title="ui.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'"
        aria-label="Переключить тему"
        @click="ui.toggleTheme()"
      >
        {{ ui.theme === 'dark' ? '☀' : '☾' }}
      </button>
    </div>
  </header>
  <EnvironmentsDialog :visible="manageVisible" @close="manageVisible = false" />
</template>
