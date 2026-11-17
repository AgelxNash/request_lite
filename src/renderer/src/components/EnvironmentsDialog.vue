<script setup>
// Диалог управления окружениями активного проекта:
// слева — список (создать/удалить), справа — редактор (имя + KV-таблица переменных).
// Esc закрывает, но не при открытом вложенном AppDialog (там Esc — его отмена).
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEnvironmentsStore } from '../stores/environments.js'
import { useProjectsStore } from '../stores/projects.js'
import KeyValueTable from './KeyValueTable.vue'

const props = defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const projects = useProjectsStore()
const environments = useEnvironmentsStore()
const dialog = inject('dialog')

const selectedId = ref(null)
// Локальная копия редактируемого окружения — сохраняется по кнопке.
const editing = ref(null)

// Esc — закрыть менеджер, если поверх не открыт вложенный AppDialog (его Esc — его отмена).
function onDocumentKeydown(event) {
  if (!props.visible || event.key !== 'Escape') return
  if (dialog.value?.visible) return
  event.preventDefault()
  emit('close')
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

const selectedEnv = computed(() => environments.items.find((e) => e.id === selectedId.value) ?? null)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      environments.load(projects.activeProjectId)
      selectedId.value = environments.items[0]?.id ?? null
      syncEditing()
    }
  }
)

function syncEditing() {
  const environment = environments.items.find((e) => e.id === selectedId.value)
  editing.value = environment ? JSON.parse(JSON.stringify({ id: environment.id, name: environment.name, variables: environment.variables })) : null
}

function selectEnv(id) {
  selectedId.value = id
  syncEditing()
}

function createEnvironment() {
  const environment = {
    id: crypto.randomUUID(),
    name: 'New Environment',
    variables: [{ id: crypto.randomUUID(), key: '', value: '', enabled: true }]
  }
  environments.save(environment).then(() => {
    selectedId.value = environment.id
    syncEditing()
  })
}

async function removeEnvironment() {
  if (!selectedEnv.value) return
  const confirmed = await dialog.value.confirm({
    title: 'Удалить окружение',
    message: `Удалить окружение «${selectedEnv.value.name}»?`,
    confirmText: 'Удалить'
  })
  if (!confirmed) return
  await environments.remove(selectedId.value)
  selectedId.value = environments.items[0]?.id ?? null
  syncEditing()
}

function addVariable() {
  editing.value?.variables.push({ id: crypto.randomUUID(), key: '', value: '', enabled: true })
}

async function saveEditing() {
  if (!editing.value) return
  const name = editing.value.name.trim() || 'Untitled Environment'
  // Полностью пустые строки (нет ни ключа, ни значения) не сохраняются.
  const variables = editing.value.variables.filter(
    (variable) => String(variable.key ?? '') !== '' || String(variable.value ?? '') !== ''
  )
  await environments.save(JSON.parse(JSON.stringify({ ...editing.value, name, variables })))
  syncEditing()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @mousedown.self="emit('close')">
    <div class="dialog env-dialog" role="dialog" aria-label="Управление окружениями">
      <h3 class="dialog-title">Окружения</h3>
      <div v-if="!projects.activeProjectId" class="dialog-message">Выберите активный проект</div>
      <template v-else>
        <div class="env-dialog-layout">
          <div class="env-list-col">
            <ul class="env-list">
              <li
                v-for="environment in environments.items"
                :key="environment.id"
                class="project-item"
                :class="{ active: environment.id === selectedId }"
                @click="selectEnv(environment.id)"
              >
                <span class="project-name">{{ environment.name }}</span>
              </li>
            </ul>
            <div class="env-actions">
              <button class="btn" @click="createEnvironment">+ Создать</button>
              <button class="btn btn-danger" :disabled="!selectedEnv" @click="removeEnvironment">Удалить</button>
            </div>
          </div>
          <div class="env-editor-col">
            <template v-if="editing">
              <label class="dialog-label" for="env-name">Имя окружения</label>
              <input id="env-name" v-model="editing.name" type="text" class="env-name-input" spellcheck="false" />
              <div class="env-vars-header">
                <span class="dialog-label">Переменные</span>
                <button class="btn" @click="addVariable">+ Переменная</button>
              </div>
              <KeyValueTable
                v-if="editing.variables.length"
                :rows="editing.variables"
                key-placeholder="Переменная"
                value-placeholder="Значение"
                @update:rows="editing.variables = $event"
              />
              <p v-else class="kv-empty">Переменных нет — добавьте первую</p>
            </template>
            <p v-else class="pane-hint">Выберите или создайте окружение</p>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" @click="emit('close')">Закрыть</button>
          <button class="btn btn-primary" :disabled="!editing" @click="saveEditing">Сохранить</button>
        </div>
      </template>
    </div>
  </div>
</template>
