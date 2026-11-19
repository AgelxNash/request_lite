# Tasks

## 1. Хранилище: мок-проекты в `storage.js`

- [x] 1.1 Секция мок-проектов: `mock-projects.json` (индекс `{id, name, createdAt, updatedAt}`) и `mock-projects/<id>.json` (`{routes, defaultResponse}`); функции `listMockProjects`, `createMockProject`, `renameMockProject`, `deleteMockProject`, `getMockProject`, `saveMockProjectConfig` — по образцу секции «Проекты» (`storage.js:76–178`), атомарная запись через `writeJsonAtomic`. Валидации: непустое имя, непустой `path` маршрута, целые `status` (100–599) и `delayMs` (≥ 0). Проверка: блок в `scripts/smoke.mjs` «--- Мок-сервер (storage) ---» — CRUD, ошибки пустого имени/пути, persist через переимпорт модуля, отсутствие `.tmp`-файлов.
- [x] 1.2 Smoke-блок storage: отдельный tmp-корень + `initStorage/bootstrap`, проверки CRUD и валидаций из 1.1. Проверка: `node scripts/smoke.mjs` проходит с новыми проверками, старые 104 не ломаются.

## 2. Main: сервер в `src/main/mock.js`

- [x] 2.1 Модуль без Electron (образец `mcp.js`): состояние `server/port/state/stateMessage/projectId/config/log`, `getMockStatus()`, очередь мутаций (паттерн `mcp.js:299–306`), `DEFAULT_MOCK_PORT = 4547`, валидация порта 1024–65535, слушатель на `127.0.0.1`, EADDRINUSE → `state:'error'` с сообщением «Порт N занят другим процессом». `startMockServer({projectId, port})` читает конфиг из `storage.js`, `stopMockServer()`. Проверка: smoke — старт/статус/адрес, стоп закрывает порт, занятый порт → error.
- [x] 2.2 Обработчик запросов: матчинг по точному пути (query игнорируется) и методу (null = любой), ответ — статус/заголовки/тело маршрута, content-type по умолчанию `application/json` (заголовки маршрута перекрывают), `delayMs`, `defaultResponse` (без него — 404 с JSON-ошибкой), `applyMockConfig(config)` меняет снимок без рестарта. Проверка: smoke — реальный `fetch` по маршруту, 404 на неотматченный, query-игнор, замер delay, новый ответ после `applyMockConfig` без рестарта.
- [x] 2.3 Журнал: буфер 500 с вытеснением, запись `{ts, method, url, headers, body}` (JSON-тело парсится), `getMockLog()`, `clearMockLog()`, хук `setLogListener(cb)` на каждую новую запись. Проверка: smoke — запись появляется после fetch с телом и заголовками, лимит вытесняет старые, clear обнуляет, записи до старта сервера не создаются.
- [x] 2.4 Smoke-блок «--- Мок-сервер (сервер) ---»: tmp-корень, `takeFreePort()` (паттерн блока MCP `smoke.mjs:1267+`), все проверки 2.1–2.3 + переключение мок-проекта на живом сервере, `finally` — `stopMockServer()` + `rm`. Проверка: `node scripts/smoke.mjs` — все блоки зелёные.

## 3. IPC, preload, время жизни сервера

- [x] 3.1 `src/main/ipc.js`: каналы `mocks:listProjects|createProject|renameProject|deleteProject|getProject|saveProject|getStatus|start|stop|getLog|clearLog` (шапка-комментарий с префиксами обновить); `saveProject` после записи в storage вызывает `applyMockConfig`, если сервер запущен на этом мок-проекте; `start`/`stop` возвращают свежий статус без броска; подписка `setLogListener` → `webContents.send('mocks:log', entry)`. Проверка: `npm run dev` — из DevTools renderer `window.api.mocks.createProject(...)` создаёт мок-проект и он виден на диске.
- [x] 3.2 `registerIpc(getMainWindow)` (вызов в `main/index.js:94` передать окно-геттер), `stopMockServer()` в `will-quit` рядом со `stopMcpServer()` (`main/index.js:111–113`). `src/preload/index.js`: неймспейс `mocks` + `onMockLog(cb)` (подписка по образцу `onMenu`). Проверка: `npm run dev` — вкладка журнала через `window.api.mocks.onMockLog` получает записи при `fetch` на запущенный сервер; закрытие окна не оставляет процесс с открытым портом (`lsof -i :<порт>` после выхода пуст).
- [x] 3.3 Push-канал `mocks:log` согласован с белым списком AGENTS.md (задача 6.1), IPC-префиксы не нарушены. Проверка: grep по `src/main/ipc.js` — все новые `ipcMain.handle`/`send` используют префиксы `mocks:*`.

## 4. Renderer: вид, store, сайдбар

- [x] 4.1 `stores/ui.js`: `view: 'requests'` + `setView(v)` (без persist в settings). `Toolbar.vue`: сегментный переключатель «Запросы | Мок-сервер» в центральной зоне тулбара. Проверка: `npm run dev` — переключатель кликается, активный сегмент подсвечен, после перезапуска приложения вид «Запросы».
- [x] 4.2 `App.vue`: условный рендер `main.editor-area` по `ui.view` (существующие `RequestTabs/RequestEditor/ResponseView` — при `requests`), `Sidebar.vue` — при `mocks` рендер `MockProjectList` вместо `ProjectList`+`RequestList`. Возврат на «Запросы» восстанавливает открытые вкладки запросов. Проверка: `npm run dev` — переключение туда-обратно, состояние вкладок запросов сохраняется.
- [x] 4.3 Store `stores/mocks.js` (образец `projects.js`): `{projects, activeProjectId, loaded, error, config, status, log}`; `load()` + `refreshStatus()` при старте приложения (рядом с `projects.load()` в `App.vue:50`), выбор активного подгружает `getProject`. `MockProjectList.vue`: список мок-проектов (клик = активный), «+» создание, переименование/удаление через `dialog.prompt/confirm` (паттерн `ProjectList.vue:151–183`), без drag/pin/lock. Проверка: `npm run dev` — CRUD мок-проектов из сайдбара, ошибка пустого имени видна, persist после перезапуска.

## 5. Renderer: панель мок-сервера

- [x] 5.1 `MockPanel.vue`: строка управления — инпут порта (по умолчанию 4547), кнопка Запустить/Остановить, статус-пилюля (остановлен/запущен с адресом/ошибка с сообщением — паттерн статуса MCP в `SettingsPage.vue:145–149`); под-вкладки «Маршруты» / «Журнал» (паттерн `RequestEditor.vue:13–14`). Проверка: `npm run dev` + echo-запрос из приложения — старт/стоп переключают статус, занятый порт показывает ошибку.
- [x] 5.2 Редактор маршрутов: карточки (select метода «любой/GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS», input path, input status, `KeyValueTable` заголовков, textarea тела, input delayMs, кнопка удаления) + блок `defaultResponse` + кнопка «Сохранить» (локальная копия → `mocks.saveProject`, ошибка валидации показывается). Сохранение при запущенном сервере применяет конфиг без рестарта. Проверка: `npm run dev` — настроить маршрут на `{{mockUrl}}`-адрес, отправить запрос из вкладки «Запросы» → ответ соответствует настройкам; правка тела при запущенном сервере меняет ответ без Stop/Start.
- [x] 5.3 Журнал: компактные строки (время, метод, путь), клик раскрывает заголовки (KV) и тело (`prettyJson` + `highlightJson` из `format.js`); живое пополнение через `onMockLog`, начальная синхронизация `getMockLog`, кнопка «Очистить» → `mocks.clearLog`. Проверка: `npm run dev` — POST с JSON-телом на запущенный сервер появляется в журнале сам, раскрытие показывает заголовки и тело, очистка обнуляет.

## 6. Документация и финальная верификация

- [x] 6.1 AGENTS.md: `src/main/mock.js` в архитектуре, префикс `mocks:*` + push `mocks:log` в списке каналов, файлы хранилища (`mock-projects.json`, `mock-projects/<id>.json`) в разделе «Хранение», пункт про мок-сервер в предметных правилах и в чек-листе ручного e2e. Проверка: разделы согласованы с фактическим кодом, `openspec validate` проходит.
- [x] 6.2 Полная верификация по чек-листу: `node scripts/smoke.mjs` (все блоки, включая мок-сервер), `npm run dev` — окно запускается; ручной e2e мока: создать мок-проект → маршрут → запустить сервер → GET/POST из приложения и curl → журнал → сохранить → перезапуск приложения (persist мок-проектов, сервер не живёт после перезапуска) → конфликт порта с echo-сервером 4545 показывает ошибку. Проверка: все команды зелёные, сценарий e2e пройден полностью.

## Workflow follow-up

- После применения: `openspec-sync-specs` или `openspec-archive-change` — слить дельты `mock-server` (новая) и `app-shell` (MODIFIED) в основные спеки.
- Опционально в будущих изменениях: drag/pin/locked мок-проектов, подстановка `{{var}}` в ответах, несколько серверов, админ-API.
