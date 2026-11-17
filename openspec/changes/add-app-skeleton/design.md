# Design

## Context

Workspace пуст — кодовая база создаётся с нуля по плану из AGENTS.md: Electron + Vue 3 + electron-vite + Pinia, чистый JS, тёмная тема. Разведка зафиксировала объём каркаса (shell + настоящий фундамент IPC/хранилища) и модель темы (тёмная/светлая, персист в `settings.json`). Среда: macOS, Node ≥ 18.

## Goals / Non-Goals

**Goals:**
- Запускаемое окно с раскладкой в стиле Postman и работающим CRUD проектов на реальных JSON-файлах.
- Зафиксированные архитектурные границы: main / preload / renderer, префиксы IPC, атомарная запись хранилища.
- Переключение темы без вспышки неправильной палитры при старте.
- Тестируемость хранилища без Electron (smoke-скрипт чистым Node).

**Non-Goals:**
- Выполнение HTTP-запросов: `src/main/http.js` и каналы `http:*` появятся в следующем изменении; Send в каркасе неактивен.
- curl-импорт/экспорт, окружения и переменные, импорт Postman-коллекций, сохранение запросов.
- Проверка дистрибутива `npm run dist` (конфигурация создаётся, но публикация/подпись — вне каркаса).

## Decisions

1. **electron-vite как сборщик** (зафиксирован планом): один конфиг на три таргета (main/preload/renderer) с HMR. Альтернатива — electron-forge с ручной интеграцией Vite: больше ручной работы при том же результате.

2. **Тестируемость storage.js**: модуль не импортирует `electron`; путь до хранилища передаётся снаружи (`initStorage(rootPath)` из `index.js`). Smoke-скрипт гоняет те же функции на временной папке. Альтернатива — держать `app.getPath` внутри модуля: смоук был бы невозможен без моков Electron.

3. **Хранилище**: `projects.json` (индекс `{id, name, createdAt, updatedAt}`), `projects/<id>.json` (`{requests: [], environments: [], activeEnvId: null}`), `settings.json` (`{theme: 'dark' | 'light'}`). ID — `crypto.randomUUID()`. Запись только через `writeJsonAtomic` (запись в `<file>.tmp`, затем `rename`). При чтении невалидного JSON — ошибка наверх (диалог пользователю), файл **не** перезаписывается автоматически, чтобы сбой записи не привёл к тихой потере данных.

4. **Поверхность IPC**: `projects:list/create/rename/delete`, `settings:get/set`, `data:openFolder`. preload открывает `window.api.projects.*`, `window.api.settings.*`, `window.api.openDataFolder()`, `window.api.onMenu(callback)`. `nodeIntegration: false`, `contextIsolation: true` (по умолчанию), всё общение — invoke/handle.

5. **Тема без FOUC**: тема по умолчанию — тёмная и прописана в CSS как `:root`; переопределение — `html[data-theme="light"]`. preload при загрузке делает один блокирующий `ipcRenderer.sendSync('settings:get')` и кладёт начальную тему в `window.api.initialSettings`, renderer применяет `data-theme` до монтирования Vue. Альтернатива — асинхронное чтение после mount: заметная вспышка тёмной темы при выбранной светлой.

6. **Только цвета — через CSS-переменные**: `--bg-primary`, `--bg-secondary`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--border`, `--accent` (оранжевый Postman #ff6c37 одинаковый в обеих темах), `--status-ok/warn/err`. Layout-метрики (ширина сайдбара, отступы) не завязаны на тему — переключение не двигает интерфейс.

7. **Собственный диалоговый компонент** (`components/AppDialog.vue`): `window.prompt`/`confirm` недоступны в Electron — ввод имени проекта, переименование и подтверждение удаления идут через модальный диалог с полем/кнопками. Один компонент, три сценария использования.

8. **Меню через main → renderer**: пункты меню создаются в main (`Menu.setApplicationMenu`); «New Project» и «Open data folder» main обрабатывает сам, а для создания проекта шлёт событие в renderer (`webContents.send('menu:new-project')`), где вызывается тот же экшн стора, что и у кнопки в сайдбаре — единый путь записи данных (только через IPC-ручки).

9. **Стейты Pinia**: `projects.js` (список, `activeProjectId`, экшены create/rename/delete/select через `window.api`), `tabs.js` (в каркасе — одна стартовая вкладка, закрытие; сохранение вкладок позже), `ui.js` (`theme`, `toggleTheme()` с записью через IPC).

10. **Каркасные компоненты**: `App.vue` (grid: тулбар / сайдбар | основная область), `Toolbar.vue` (название, селектор окружения disabled, кнопка темы), `Sidebar.vue` (+ `ProjectList.vue`), `RequestTabs.vue`, `RequestEditor.vue` (метод и URL редактируемые в стейте вкладки, Send `disabled`), `ResponseView.vue` (пустое состояние), `AppDialog.vue`. `KeyValueTable.vue`, `BodyTab.vue`, `AuthTab.vue` и остальные — в следующих изменениях, чтобы не плодить мёртвые заглушки.

11. **scripts/**: `smoke.mjs` — CRUD хранилища на tmp-папке (создание/переименование/удаление/персистентность/атомарность структуры файлов); `echo-server.mjs` — минимальный echo-сервер на 4545, создаётся сейчас для будущих ручных e2e.

## Risks / Trade-offs

- [Вспышка неправильной темы при старте] → блокирующее чтение настроек один раз в preload до mount (решение 5); дефолт тёмный совпадает с CSS-дефолтом.
- [Повреждённый JSON-файл хранилища] → не перезаписывается автоматически; пользователь получает диалог с ошибкой и путь до файла, чтобы спасти данные руками.
- [`window.prompt` недоступен в Electron] → собственный диалог (решение 7), известная ловушка Electron, закрыта на уровне каркаса.
- [Нет окон подтверждения удаления через нативные диалоги] → модальный AppDialog даёт единый стиль подтверждений; нативный `dialog.showMessageBox` оставляем как альтернативу на будущее.
- [electron-builder на ARM mac без подписи] → `identity: null` + `CSC_IDENTITY_AUTO_DISCOVERY=false` в конфиге и скрипте, сборка помечена unsigned.

## Migration Plan

Greenfield: миграций нет. Откат — удаление созданных файлов; пользовательские данные появляются только в `userData/storage/` и не зависят от кода.

## Open Questions

Нет — все развилки закрыты разведкой (объём каркаса, модель темы).
