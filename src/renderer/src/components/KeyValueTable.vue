<script setup>
// KV-таблица «галочка — ключ — значение — удалить» для Params/Headers/form-data/urlencoded.
// Автодобавляет пустую строку при вводе в последнюю — как в Postman.
const props = defineProps({
  rows: { type: Array, required: true },
  keyPlaceholder: { type: String, default: 'Ключ' },
  valuePlaceholder: { type: String, default: 'Значение' }
})
const emit = defineEmits(['update:rows'])

let nextLocalId = 1
function makeRow() {
  return { id: `kv-${nextLocalId++}`, key: '', value: '', enabled: true }
}

function updateRow(id, patch) {
  let next = props.rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
  const edited = next.find((row) => row.id === id)
  const last = next[next.length - 1]
  // Ввод в последнюю строку порождает новую пустую снизу.
  if ((patch.key !== undefined || patch.value !== undefined) && edited && edited === last) {
    if (edited.key !== '' || edited.value !== '') next = [...next, makeRow()]
  }
  emit('update:rows', next)
}

function removeRow(id) {
  emit('update:rows', props.rows.filter((row) => row.id !== id))
}
</script>

<template>
  <div class="kv-table">
    <div v-for="row in rows" :key="row.id" class="kv-row" :class="{ disabled: !row.enabled }">
      <input
        type="checkbox"
        class="kv-check"
        :checked="row.enabled"
        :aria-label="`Включить ${row.key || 'строку'}`"
        @change="updateRow(row.id, { enabled: $event.target.checked })"
      />
      <input
        class="kv-key"
        type="text"
        :placeholder="keyPlaceholder"
        :value="row.key"
        spellcheck="false"
        @input="updateRow(row.id, { key: $event.target.value })"
      />
      <input
        class="kv-value"
        type="text"
        :placeholder="valuePlaceholder"
        :value="row.value"
        spellcheck="false"
        @input="updateRow(row.id, { value: $event.target.value })"
      />
      <button
        class="btn-icon btn-icon-danger kv-remove"
        title="Удалить строку"
        aria-label="Удалить строку"
        @click="removeRow(row.id)"
      >
        ×
      </button>
    </div>
    <p v-if="!rows.length" class="kv-empty">Строк нет — введите ключ, чтобы добавить</p>
  </div>
</template>
