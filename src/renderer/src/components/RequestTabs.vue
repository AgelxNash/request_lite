<script setup>
import { computed, inject, ref } from 'vue'
import { useProjectsStore } from '../stores/projects.js'
import { useRequestsStore } from '../stores/requests.js'
import { useTabsStore } from '../stores/tabs.js'
import { generateCurl } from '../lib/curl.js'
import { toSnapshot } from '../stores/tabs.js'
import ContextMenu from './ContextMenu.vue'
import CurlExportPanel from './CurlExportPanel.vue'

const tabs = useTabsStore()
const projects = useProjectsStore()
const requests = useRequestsStore()
const dialog = inject('dialog')

const contextMenu = ref(null)
const menuTabId = ref(null)
const curlPanelVisible = ref(false)
const curlPanelText = ref('')

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
  // Связанный с кликнутой вкладкой запрос заблокирован → «Сохранить» неактивен.
  const linkedLocked =
    !!tab.savedRequestId &&
    requests.items.find((r) => r.id === tab.savedRequestId)?.locked === true
  return [
    {
      label: 'Сохранить',
      disabled: tab.sending || !projects.activeProjectId || linkedLocked,
      title: projects.activeProjectId
        ? linkedLocked
          ? 'Запрос заблокирован — разблокируйте, чтобы сохранить'
          : ''
        : 'Выберите активный проект',
      action: () => tabs.saveTab(tab.id, dialog.value)
    },
    {
      label: 'Клонировать',
      action: () => tabs.cloneTab(tab.id)
    },
    {
      label: 'Копировать как cURL',
      action: () => {
        curlPanelText.value = generateCurl(toSnapshot(tab))
        curlPanelVisible.value = true
      }
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
    <CurlExportPanel :visible="curlPanelVisible" :text="curlPanelText" @close="curlPanelVisible = false" />
  </div>
</template>
