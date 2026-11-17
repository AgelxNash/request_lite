# Tasks

## 1. Каркас проекта и сборка

- [ ] 1.1 Создать `package.json` (зависимости: electron, electron-vite, vue, pinia, electron-builder; скрипты dev/build/dist с отключённой подписью), `electron.vite.config.mjs`, `.gitignore`; выполнить `npm install`. Проверка: `npm run dev` запускает процесс Electron.
- [ ] 1.2 Создать `src/main/index.js`: BrowserWindow ~1200×800 с тёмным `backgroundColor`, меню с пунктами New Project и Open data folder (пока заглушки), `nodeIntegration: false`. Проверка: окно открывается, оба пункта меню отображаются.
- [ ] 1.3 Создать `src/preload/index.js` (contextBridge-обёртки над invoke) и минимальный renderer (`src/renderer/index.html`, `main.js`, `App.vue` с заголовком «Postman Lite»). Проверка: `window.api` доступен в DevTools, заголовок виден в окне.

## 2. Хранилище (main-процесс, без Electron-зависимостей)

- [ ] 2.1 Создать `src/main/storage.js`: `initStorage(rootPath)`, атомарная запись `writeJsonAtomic` (tmp + rename), `readJson` с ошибкой на невалидном JSON, CRUD проектов (`projects.json` + `projects/<id>.json`, id через `crypto.randomUUID`, createdAt/updatedAt). Проверка: ручной вызов функций на временной папке создаёт/меняет ожидаемые файлы.
- [ ] 2.2 Создать `scripts/smoke.mjs` (чистый Node): создание → список → переименование → удаление → повторное чтение (persist), проверка структуры файлов, кейс «невалидный JSON не затирается». Проверка: `node scripts/smoke.mjs` проходит зелёным.
- [ ] 2.3 Добавить в `storage.js` `getSettings`/`setSettings` с дефолтом `{theme: 'dark'}` и кейс настроек в `smoke.mjs`. Проверка: новый кейс смоука проходит.

## 3. IPC-контур

- [ ] 3.1 Создать `src/main/ipc.js`: ручки `projects:list/create/rename/delete`, `settings:get/set`, `data:openFolder` (через shell), инициализация хранилища в `userData/storage`. Проверка: вызовы `window.api.projects.list()` из DevTools возвращают данные из реальной папки хранилища.
- [ ] 3.2 Дописать preload до полной поверхности: `window.api.projects.*`, `window.api.settings.*`, `window.api.openDataFolder()`, `window.api.onMenu(callback)`. Проверка: все методы из DevTools отвечают без ошибок; папка `userData/storage` создаётся при первом запуске.

## 4. Раскладка и проекты (renderer)

- [ ] 4.1 Создать `src/renderer/src/assets/style.css`: CSS-переменные обеих тем (тёмная в `:root`, светлая в `html[data-theme="light"]`, палитра Postman, `--accent #ff6c37`); `App.vue` как grid (тулбар / сайдбар | основная область). Проверка: раскладка трёх зон соответствует схеме из proposal, сайдбар показывает пустое состояние с приглашением.
- [ ] 4.2 Создать `stores/projects.js` (list/create/rename/delete/select через `window.api`), `Sidebar.vue` + `ProjectList.vue`: список проектов, кнопка «+ New Project», подсветка активного. Проверка: созданный из UI проект появляется в сайдбаре и в `projects.json` на диске.
- [ ] 4.3 Создать `AppDialog.vue` (ввод имени для create/rename, подтверждение удаления) и подключить к действиям сайдбара. Проверка: create/rename/delete через диалоги; отмена подтверждения удаления оставляет данные без изменений.
- [ ] 4.4 Связать меню: New Project шлёт `menu:new-project` в renderer и вызывает тот же экшн стора; Open data folder открывает папку хранилища. Проверка: оба пункта меню работают и попадают в те же данные.

## 5. Тема

- [ ] 5.1 Создать `stores/ui.js` (`theme`, `toggleTheme` с записью через IPC); в preload — один блокирующий `sendSync('settings:get')` с начальной темой в `window.api.initialSettings`; renderer применяет `data-theme` до монтирования Vue. Проверка: переключение темы мгновенное, раскладка не смещается.
- [ ] 5.2 Создать `Toolbar.vue`: название приложения, селектор окружения (disabled), кнопка солнце/луна. Проверка: выбор темы записывается в `settings.json`; после перезапуска приложение открывается в выбранной теме без вспышки тёмной.

## 6. Каркасные зоны и интеграция

- [ ] 6.1 Создать `RequestTabs.vue` (одна стартовая вкладка, закрытие), `RequestEditor.vue` (метод + URL редактируемые в стейте вкладки, Send `disabled`, вкладки Params/Headers/Body/Auth как пустые зоны), `ResponseView.vue` (пустое состояние «отправьте запрос»). Проверка: визуально основная область соответствует раскладке Postman из proposal.
- [ ] 6.2 Создать `scripts/echo-server.mjs` (echo GET/POST на порту 4545). Проверка: `curl http://localhost:4545/ping` отвечает эхом.
- [ ] 6.3 Интеграционная проверка каркаса: `node scripts/smoke.mjs`; `npm run dev` → создать проект, переименовать, удалить, переключить тему, перезапустить приложение и убедиться в персистентности. Проверка: все сценарии из трёх дельт спек выполняются вручную без ошибок в консоли.

## Workflow follow-up

- После реализации: прогнать `openspec validate --change add-app-skeleton`, при завершении — sync-specs/archive, затем обновить раздел «Хранение» в AGENTS.md (добавить `settings.json`).
