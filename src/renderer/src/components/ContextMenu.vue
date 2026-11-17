<script setup>
// Веб-контекстное меню в стиле приложения (нативное Menu.popup не используется).
// Пункты: {label, disabled?, title?, action?}. Позиционируется у курсора с clamp к краям окна.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  items: { type: Array, default: () => [] }
})

const visible = ref(false)
const position = ref({ x: 0, y: 0 })
const positionStyle = computed(() => ({ left: `${position.value.x}px`, top: `${position.value.y}px` }))

// ~200px ширина и ~34px на пункт — для clamp при открытии у правого/нижнего края.
function openAt(x, y) {
  const width = 200
  const height = 34 * 2 + 8
  position.value = {
    x: Math.max(4, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(4, Math.min(y, window.innerHeight - height - 8))
  }
  visible.value = true
}

function close() {
  visible.value = false
}

function choose(item) {
  if (item.disabled) return
  close()
  item.action?.()
}

function onDocumentClick() {
  if (visible.value) close()
}

function onKeydown(event) {
  if (event.key === 'Escape' && visible.value) close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ openAt, close })
</script>

<template>
  <div v-if="visible" class="context-menu" :style="positionStyle">
    <button
      v-for="item in items"
      :key="item.label"
      class="context-menu-item"
      type="button"
      :disabled="item.disabled"
      :title="item.title ?? ''"
      @click="choose(item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
