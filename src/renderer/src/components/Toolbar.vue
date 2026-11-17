<script setup>
import { useUiStore } from '../stores/ui.js'

const ui = useUiStore()
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-brand"><span class="brand-accent">Postman</span> Lite</div>
    <div class="toolbar-center">
      <select class="env-select" disabled title="Окружения появятся в следующем изменении">
        <option>No Environment</option>
      </select>
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
</template>
