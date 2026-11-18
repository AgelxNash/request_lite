<script setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
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
const stripEl = ref(null)

// --- Перетаскивание вкладок: свои pointer-события, без зависимостей ---
// Порог отличает клик от drag; у краёв полосы включается автоскролл.
const DRAG_THRESHOLD = 4
const EDGE_ZONE = 24
const EDGE_STEP = 12

const draggingId = ref(null)
// Внутреннее состояние drag вне реактивности: в шаблон попадает только draggingId.
let drag = null
let edgeRaf = 0
let edgeDir = 0

// Меню таргетит кликнутую вкладку (не обязательно активную); drag и меню несовместимы.
function openTabMenu(tab, event) {
  endDrag()
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
      label: tab.pinned ? 'Открепить' : 'Закрепить',
      action: () => tabs.togglePin(tab.id)
    },
    {
      label: 'Копировать как cURL',
      action: () => {
        curlPanelText.value = generateCurl(toSnapshot(tab))
        curlPanelVisible.value = true
      }
    },
    {
      label: 'Закрыть вкладку',
      action: () => tabs.closeTab(tab.id)
    }
  ]
})

// Клик активирует вкладку. После drag ложный click не страшен: без capture он
// уходит на общего предка (строку), а на самой вкладке — только если жест
// завершился на ней, и активация в этом случае и есть ожидаемое поведение.
function onTabPointerDown(tab, event) {
  // Drag — только левой кнопкой; × и булавка останавливают pointerdown на себе.
  if (event.button !== 0 || drag) return
  drag = {
    id: tab.id,
    startX: event.clientX,
    startY: event.clientY,
    clientX: event.clientX,
    active: false
  }
  // Слушатели на window, без setPointerCapture: вкладка при живой перестановке
  // перемещается по DOM, а capture при удалении из дерева снимается неявно —
  // после первого swap события переставали приходить и drag зависал.
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', endDrag)
}

function onWindowPointerMove(event) {
  if (!drag) return
  drag.clientX = event.clientX
  if (!drag.active) {
    const offset = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY)
    if (offset < DRAG_THRESHOLD) return
    drag.active = true
    draggingId.value = drag.id
    window.addEventListener('keydown', onDragKeydown)
  }
  applyDragPosition()
  updateEdgeScroll()
}

function onWindowPointerUp() {
  endDrag()
}

// Завершение drag: снимает класс, автоскролл и Escape. Порядок не откатывается —
// перестановки уже применены (как в Chrome).
function endDrag() {
  if (!drag) return
  stopEdgeScroll()
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', endDrag)
  window.removeEventListener('keydown', onDragKeydown)
  draggingId.value = null
  drag = null
}

function onDragKeydown(event) {
  if (event.key === 'Escape') endDrag()
}

// Живая перестановка: курсор прошёл середину соседа — вкладка меняется с ним местами.
// Границу зон закрепления учитывает сам экшен стора moveTab.
function applyDragPosition() {
  const els = stripEl.value ? [...stripEl.value.querySelectorAll('.tab')] : []
  const from = els.findIndex((el) => Number(el.dataset.id) === drag.id)
  if (from === -1) return
  const rect = els[from].getBoundingClientRect()
  const middle = rect.left + rect.width / 2
  let to = from
  if (drag.clientX > middle && from < els.length - 1) {
    const next = els[from + 1].getBoundingClientRect()
    if (drag.clientX > next.left + next.width / 2) to = from + 1
  } else if (drag.clientX < middle && from > 0) {
    const prev = els[from - 1].getBoundingClientRect()
    if (drag.clientX < prev.left + prev.width / 2) to = from - 1
  }
  if (to !== from) tabs.moveTab(drag.id, to)
}

// Автоскролл полосы у краёв: шаг за кадр, позиция пересчитывается каждый кадр —
// прокрутка двигает вкладки под неподвижным курсором.
function updateEdgeScroll() {
  const strip = stripEl.value
  if (!strip) return
  const rect = strip.getBoundingClientRect()
  if (drag.clientX - rect.left < EDGE_ZONE) edgeDir = -1
  else if (rect.right - drag.clientX < EDGE_ZONE) edgeDir = 1
  else edgeDir = 0
  if (edgeDir !== 0 && !edgeRaf) edgeRaf = requestAnimationFrame(edgeScrollFrame)
}

function edgeScrollFrame() {
  edgeRaf = 0
  const strip = stripEl.value
  if (!drag?.active || !edgeDir || !strip) return
  strip.scrollLeft += edgeDir * EDGE_STEP
  applyDragPosition()
  updateEdgeScroll()
}

function stopEdgeScroll() {
  if (edgeRaf) {
    cancelAnimationFrame(edgeRaf)
    edgeRaf = 0
  }
  edgeDir = 0
}

onBeforeUnmount(endDrag)
</script>

<template>
  <div class="request-tabs">
    <div ref="stripEl" class="tabs-strip" :class="{ 'is-dragging': draggingId !== null }">
      <button
        v-for="tab in tabs.tabs"
        :key="tab.id"
        :data-id="tab.id"
        class="tab"
        :class="{ active: tab.id === tabs.activeTabId, pinned: tab.pinned, dragging: tab.id === draggingId }"
        :title="tab.name"
        @click="tabs.setActive(tab.id)"
        @dblclick="tabs.togglePin(tab.id)"
        @contextmenu.prevent="openTabMenu(tab, $event)"
        @pointerdown="onTabPointerDown(tab, $event)"
      >
        <span class="tab-method" :class="`method-${tab.method}`">{{ tab.method }}</span>
        <span class="tab-name">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="tab-dirty" title="Есть несохранённые изменения">•</span>
        <span
          v-if="tab.pinned"
          class="tab-pin"
          role="button"
          aria-label="Открепить вкладку"
          title="Открепить вкладку"
          @pointerdown.stop
          @dblclick.stop
          @click.stop="tabs.togglePin(tab.id)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M5.5 2h5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H9.25v3.75l1.9 1.42a.62.62 0 0 1-.37 1.11H5.22a.62.62 0 0 1-.37-1.11l1.9-1.42V7.5H5.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"
            />
          </svg>
        </span>
        <span
          v-else
          class="tab-close"
          role="button"
          aria-label="Закрыть вкладку"
          title="Закрыть вкладку"
          @pointerdown.stop
          @dblclick.stop
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
