<script setup>
import { onMounted, provide, ref } from 'vue'
import { useProjectsStore } from './stores/projects.js'
import { useTabsStore } from './stores/tabs.js'
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import RequestTabs from './components/RequestTabs.vue'
import RequestEditor from './components/RequestEditor.vue'
import ResponseView from './components/ResponseView.vue'
import AppDialog from './components/AppDialog.vue'

const projects = useProjectsStore()
const tabs = useTabsStore()
const dialog = ref(null)

// Диалог доступен вложенным компонентам (переименование/удаление проектов в сайдбаре).
provide('dialog', dialog)

onMounted(async () => {
  tabs.openStartTab()
  await projects.load()
  window.api?.onMenu((action) => {
    if (action === 'new-project') newProject()
    if (action === 'save-request') tabs.saveActiveViaDialog(dialog.value)
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
  </div>
</template>
