<script setup>
import { onMounted, provide, ref } from 'vue'
import { parseCollection } from './lib/postman.js'
import { useEnvironmentsStore } from './stores/environments.js'
import { useMocksStore } from './stores/mocks.js'
import { useProjectsStore } from './stores/projects.js'
import { useTabsStore } from './stores/tabs.js'
import { useUiStore } from './stores/ui.js'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import RequestTabs from './components/RequestTabs.vue'
import RequestEditor from './components/RequestEditor.vue'
import ResponseView from './components/ResponseView.vue'
import MockPanel from './components/MockPanel.vue'
import AppDialog from './components/AppDialog.vue'
import CurlImportDialog from './components/CurlImportDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import SettingsPage from './components/SettingsPage.vue'

const projects = useProjectsStore()
const tabs = useTabsStore()
const environments = useEnvironmentsStore()
const mocks = useMocksStore()
const ui = useUiStore()
const dialog = ref(null)
const curlImportVisible = ref(false)
const aboutVisible = ref(false)
const settingsVisible = ref(false)

// Импорт коллекции Postman: file picker → парсинг → bulk-импорт в новый проект.
async function importPostman() {
  const picked = await window.api.postman.pickAndRead()
  if (!picked.ok) {
    if (picked.error) {
      await dialog.value.alert({ title: 'Импорт коллекции', message: picked.error })
    }
    return // отмена выбора файла — ничего не делаем
  }
  let parsed
  try {
    parsed = parseCollection(picked.content)
  } catch (err) {
    await dialog.value.alert({ title: 'Импорт коллекции', message: err?.message ?? 'Не удалось разобрать файл' })
    return
  }
  await projects.importCollection({ name: parsed.name, requests: parsed.requests, variables: parsed.variables })
  await environments.load(projects.activeProjectId)
}

// Диалог доступен вложенным компонентам (переименование/удаление проектов в сайдбаре).
provide('dialog', dialog)

onMounted(async () => {
  tabs.openStartTab()
  await projects.load()
  // Мок-проекты и статус слушателя — лёгкие чтения: грузим при старте,
  // чтобы вкладка «Мок-сервер» была готова к первому переключению.
  mocks.load()
  mocks.refreshStatus()
  window.api?.onMenu((action) => {
    if (action === 'new-project') newProject()
    if (action === 'save-request') tabs.saveActiveViaDialog(dialog.value)
    if (action === 'import-curl') curlImportVisible.value = true
    if (action === 'import-postman') importPostman()
    if (action === 'settings') settingsVisible.value = true
    if (action === 'about') aboutVisible.value = true
  })
})

async function newProject() {
  const name = await dialog.value.prompt({
    title: 'Новый проект',
    label: 'Имя проекта',
    value: '',
    confirmText: 'Создать'
  })
  if (name === null) return
  await projects.create(name)
}

async function newMockProject() {
  const name = await dialog.value.prompt({
    title: 'Новый мок-проект',
    label: 'Имя мок-проекта',
    value: '',
    confirmText: 'Создать'
  })
  if (name === null) return
  try {
    await mocks.create(name)
  } catch (error) {
    await dialog.value.alert({ title: 'Новый мок-проект', message: error?.message ?? 'Не удалось создать мок-проект' })
  }
}
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="app-main">
      <Sidebar @new-project="newProject" @new-mock-project="newMockProject" />
      <main class="editor-area">
        <template v-if="ui.view === 'requests'">
          <RequestTabs />
          <RequestEditor />
          <ResponseView />
        </template>
        <MockPanel v-else />
      </main>
    </div>
    <AppDialog ref="dialog" />
    <CurlImportDialog :visible="curlImportVisible" @close="curlImportVisible = false" />
    <AboutDialog :visible="aboutVisible" @close="aboutVisible = false" />
    <SettingsPage :visible="settingsVisible" @close="settingsVisible = false" />
  </div>
</template>
