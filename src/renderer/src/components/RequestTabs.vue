<script setup>
import { useTabsStore } from '../stores/tabs.js'

const tabs = useTabsStore()
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
  </div>
</template>
