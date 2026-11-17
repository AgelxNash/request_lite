import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useUiStore } from './stores/ui.js'
import './assets/style.css'

const app = createApp(App)
app.use(createPinia())

// Применить сохранённую тему до монтирования — без вспышки неправильной палитры.
// window.api.initialSettings заполнен синхронно в preload.
const ui = useUiStore()
ui.applyInitialTheme(window.api?.initialSettings)

app.mount('#app')
