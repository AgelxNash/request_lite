<script setup>
import { onMounted, provide, ref } from 'vue'
import { parseCollection } from './lib/postman.js'
import { useEnvironmentsStore } from './stores/environments.js'
import { useProjectsStore } from './stores/projects.js'
import { useTabsStore } from './stores/tabs.js'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import RequestTabs from './components/RequestTabs.vue'
import RequestEditor from './components/RequestEditor.vue'
import ResponseView from './components/ResponseView.vue'
import AppDialog from './components/AppDialog.vue'
import CurlImportDialog from './components/CurlImportDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import SettingsPage from './components/SettingsPage.vue'

const projects = useProjectsStore()
const tabs = useTabsStore()
const environments = useEnvironmentsStore()
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
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="app-main">
      <Sidebar @new-project="newProject" />
      <main class="editor-area">
        <RequestTabs />
        <RequestEditor />
        <ResponseView />
      </main>
    </div>
    <AppDialog ref="dialog" />
    <CurlImportDialog :visible="curlImportVisible" @close="curlImportVisible = false" />
    <AboutDialog :visible="aboutVisible" @close="aboutVisible = false" />
    <SettingsPage :visible="settingsVisible" @close="settingsVisible = false" />
  </div>
</template>
