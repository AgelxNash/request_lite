<script setup>
import { ref } from 'vue'
import { useTabsStore } from '../stores/tabs.js'

const tabs = useTabsStore()
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const requestTabs = ['Params', 'Headers', 'Body', 'Auth']
const activeRequestTab = ref('Params')
</script>

<template>
  <section class="request-editor">
    <div class="request-line">
      <select
        class="method-select"
        :value="tabs.activeTab?.method"
        aria-label="Метод запроса"
        @change="tabs.updateActive({ method: $event.target.value })"
      >
        <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
      </select>
      <input
        class="url-input"
        type="text"
        placeholder="https://example.com/api"
        spellcheck="false"
        :value="tabs.activeTab?.url"
        aria-label="URL запроса"
        @input="tabs.updateActive({ url: $event.target.value })"
      />
      <button class="btn btn-primary send-btn" disabled title="Отправка запросов появится в следующем изменении">
        Send
      </button>
    </div>
    <div class="request-tabs-row">
      <button
        v-for="name in requestTabs"
        :key="name"
        class="request-tab"
        :class="{ active: activeRequestTab === name }"
        @click="activeRequestTab = name"
      >
        {{ name }}
      </button>
    </div>
    <div class="request-tab-content">
      <p class="placeholder">Раздел «{{ activeRequestTab }}» будет заполнен в следующем изменении.</p>
    </div>
  </section>
</template>
