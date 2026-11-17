<script setup>
import { computed, inject, ref } from 'vue'
import { useProjectsStore } from '../stores/projects.js'
import { useTabsStore } from '../stores/tabs.js'
import ContextMenu from './ContextMenu.vue'

const tabs = useTabsStore()
const projects = useProjectsStore()
const dialog = inject('dialog')

const contextMenu = ref(null)
const menuTabId = ref(null)

// Меню таргетит кликнутую вкладку (не обязательно активную).
function openTabMenu(tab, event) {
  menuTabId.value = tab.id
  contextMenu.value?.openAt(event.clientX, event.clientY)
}

function closeTabMenu() {
  menuTabId.value = null
}

const menuItems = computed(() => {
  const tab = tabs.tabs.find((t) => t.id === menuTabId.value)
  if (!tab) return []
  return [
    {
      label: 'Сохранить',
      disabled: tab.sending || !projects.activeProjectId,
      title: projects.activeProjectId ? '' : 'Выберите активный проект',
      action: () => tabs.saveTab(tab.id, dialog.value)
    },
    {
      label: 'Клонировать',
      action: () => tabs.cloneTab(tab.id)
    }
  ]
})
</script>

<template>
  <div class="request-tabs">
    <div class="tabs-strip">
      <button
        v-for="tab in tabs.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === tabs.activeTabId }"
        :title="tab.name"
        @click="tabs.setActive(tab.id)"
        @contextmenu.prevent="openTabMenu(tab, $event)"
      >
        <span class="tab-method" :class="`method-${tab.method}`">{{ tab.method }}</span>
        <span class="tab-name">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="tab-dirty" title="Есть несохранённые изменения">•</span>
        <span
          class="tab-close"
          role="button"
          aria-label="Закрыть вкладку"
          title="Закрыть вкладку"
          @click.stop="tabs.closeTab(tab.id)"
        >
          ×
        </span>
      </button>
      <button class="btn-icon tab-add" title="Новый запрос" aria-label="Новый запрос" @click="tabs.openTab()">
        +
      </button>
    </div>
    <ContextMenu ref="contextMenu" :items="menuItems" @close="closeTabMenu" />
  </div>
</template>
