# Design: Встроенный мок-сервер

## Context

Слои приложения закреплены AGENTS.md: HTTP-серверы живут в main (`mcp.js` как образец «сервер в main без Electron-зависимостей», тестируемый в smoke напрямую), renderer общается только через preload `window.api.*`, IPC — по строгим префиксам, JSON — атомарная запись в `storage.js`. Данные, определяющие поведение списков (порядок, pin/locked), живут на диске. Существующая раскладка (`App.vue:73–89`): `Toolbar` + `Sidebar` (`ProjectList`/`RequestList`) + `main.editor-area` (`RequestTabs`/`RequestEditor`/`ResponseView`). Роутера нет; вид как состояние в `ui.js` отсутствует (там только theme). Внешний CLI `scripts/mock-server.mjs` задаёт формат конфига `{routes, defaultResponse}` и семантику лога — его переиспользуем как источник формата данных (сам скрипт в приложение не импортируется).

См. proposal.md — Why. Решения по объёму подтверждены пользователем: отдельные мок-проекты; один активный сервер; без админ-API `/__admin`.

## Goals / Non-Goals

**Goals:**
- `src/main/mock.js` — сервер, журнал, старт/стоп, горячее применение конфига; чистый Node, без Electron (как `mcp.js`), для прямого импорта в smoke.
- Секция мок-проектов в `storage.js` по образцу секции «Проекты» (индекс + файл на проект, атомарная запись, guard'ы).
- Вкладка «Мок-сервер» в renderer: список мок-проектов в сайдбаре, панель управления сервером, редактор маршрутов, живой журнал.
- Push-канал журнала main → renderer по образцу `menu:*` подписок.

**Non-Goals:**
- Несколько одновременных серверов, админ-API `/__admin`, подстановка `{{var}}` в мок-ответах.
- drag/pin/locked у мок-проектов и у маршрутов (v1 — простой CRUD; порядок маршрутов не влияет на матчинг, кроме как порядок перебора).
- Persist журнала на диск; persist выбранного вида и активного мок-проекта в settings.
- Проверка входящих запросов на авторизацию/токен.

## Decisions

### D1. Сервер — отдельный main-модуль `src/main/mock.js` (не расширение mcp.js)
Модульные переменные: `server`, `port`, `state` (`stopped|running|error`), `stateMessage`, `projectId` (мок-проект, на котором запущен), `config` (in-memory снимок `{routes, defaultResponse}`), `log` (буфер), `logListener` (хук для push). API: `getMockStatus()`, `startMockServer({projectId, port})`, `stopMockServer()`, `applyMockConfig(config)`, `getMockLog()`, `clearMockLog()`, `setLogListener(cb)`. Мутации (start/stop/applyConfig) — через последовательную очередь-цепочку Promise (`mutationChain`, паттерн `mcp.js:299–306`) — устраняет race при быстром Start/Stop. Порт: `DEFAULT_MOCK_PORT = 4547` (не пересекается с echo 4545, CLI 4546, MCP 45460), валидация 1024–65535 как в `mcp.js:61–67`. Слушатель на `127.0.0.1`. Альтернатива «расширить mcp.js» отклонена: разные транспорт и назначение, mcp.js и так на пределе размера.

### D2. Конфигурация активного сервера — in-memory снимок, горячее обновление
При старте `mock.js` читает конфиг мок-проекта из `storage.js` в переменную `config`; обработчик запроса работает только с ней (не с диском на каждый запрос — отличие от CLI, где файл перечитывался). IPC `mocks:saveProject` сохраняет конфиг в storage и, если сервер запущен на этом же мок-проекте, вызывает `applyMockConfig(newConfig)` — следующая запись `config` подставляется без рестарта. Альтернатива «перечитывать диск на каждый запрос» — лишние чтения и вопрос консистентности между записями; альтернатива «рестарт сервера на каждое сохранение» — разрыв обработки в момент сохранения.

### D3. Модель данных (формат повторяет CLI)
Индекс `mock-projects.json`: массив `{id, name, createdAt, updatedAt}` (порядок = порядок в сайдбаре). Файл `mock-projects/<id>.json`: `{routes: [...], defaultResponse}`. Маршрут: `{id, method (null = «любой»), path, status, headers: [{key, value, enabled}], body (raw string|null), delayMs}`; `defaultResponse: {status, body} | null`. Тело — raw-строка (валидный JSON отдаётся как есть, content-type по умолчанию `application/json`, заголовки маршрута перекрывают — семантика `sendJson` из CLI). Альтернатива «body как структура {type, text} как у запросов» — не нужна: у мок-ответа один тип (текст), структура усложняет редактор и валидацию.

### D4. Секция storage без locked/pinned/drag
Функции `listMockProjects`, `createMockProject`, `renameMockProject`, `deleteMockProject` (guard'ов нет — блокировок в v1 не завели, удаление файла через `rm force` как у проектов), `getMockProject`, `saveMockProjectConfig(id, {routes, defaultResponse})`. Валидации: непустое имя (как `createProject`), непустой `path` каждого маршрута, статус — целое 100–599, `delayMs` — целое ≥ 0; записи атомарные (`writeJsonAtomic`). Активный мок-проект — runtime-состояние store, не диск. Осознанное упрощение: не переносим защитные флаги проектов запросов на мок-проекты в v1 (AGENTS.md модель списков не нарушаем — новые списки просто не перетаскиваются).

### D5. IPC: префикс `mocks:*` + push-канал `mocks:log`
Каналы: `mocks:listProjects|createProject|renameProject|deleteProject|getProject|saveProject|getStatus|start|stop|getLog|clearLog`. Ошибки — через reject с русским сообщением (паттерн `projects:*`); `start` и `setConfig`-подобные не бросают, а возвращают свежий статус (EADDRINUSE → `{state:'error', message}` — паттерн `mcp.js:450–472`). Push: при каждой новой записи лога `mock.js` дергает `logListener(entry)`; подписка ставится в `ipc.js`, который для этого должен получать окно — `registerIpc(getMainWindow)` (сейчас `registerIpc()` без аргументов, вызов в `main/index.js:94`; push `menu:*` отправляется из `index.js` напрямую, но для периодического лога логично жить в ipc.js). Префикс и push-канал добавляются в белый список AGENTS.md (сейчас push описан только для `menu:*`).

### D6. Вид и вкладка в renderer: состояние в `ui.js`, ленивая логика не нужна
`ui.js`: `view: 'requests' | 'mocks'` + `setView(v)`. Без persist (спека: сброс при перезапуске). `App.vue`: в `main.editor-area` условный рендер по `ui.view` (существующий блок сохраняется как есть), `Toolbar.vue` — сегментный переключатель в `toolbar-center`. `Sidebar.vue` — по `ui.view` рендерит `ProjectList`+`RequestList` либо `MockProjectList`. Store `mocks.js` по образцу `projects.js`: `{projects, activeProjectId, loaded, error, config, status, log}`; загрузка списка + `getStatus` при старте приложения (рядом с `projects.load()`), конфиг активного — при выборе. `MockPanel.vue`: строка управления (порт-инпут с применением при Start, кнопка Запустить/Остановить, статус-пилюля) + под-вкладки «Маршруты» / «Журнал» (паттерн под-вкладок `RequestEditor.vue:13–14`). Редактор маршрутов: карточки маршрутов (select метода, input path/status/delayMs, `KeyValueTable` для заголовков — переиспользование, textarea тела, кнопка удаления) + блок `defaultResponse` + кнопка «Сохранить» (локальная копия → `mocks.saveProject`). Журнал: компактные строки (время, метод, путь), клик раскрывает заголовки и тело; тело — `prettyJson` + `highlightJson` из `format.js` (переиспользование). `onMockLog` подписка в компоненте журнала, по открытию — `getMockLog`.

### D7. Тесты: блок «Мок-сервер» в smoke
Секция по образцу блока MCP (`smoke.mjs:1267–1493`): свой tmp-корень + `initStorage/bootstrap`, `takeFreePort()`, динамический импорт `src/main/mock.js`. Проверки: CRUD мок-проектов и валидации storage; старт/статус/адрес; fetch по маршруту (статус/тело/заголовки/content-type); query-игнор; default-ответ; `delayMs` по замеру; горячий `applyMockConfig`; журнал (запись тела/заголовков, лимит, clear, отсутствие записей до старта); EADDRINUSE → `state:'error'`; переключение мок-проекта; `finally` — `stopMockServer()` + `rm`. IPC/preload/UI в smoke не попадают (как и сейчас).

## Risks / Trade-offs

- [Одно окно: push-журнал пишется только в главное окно] → приложение открывает одно окно (как и `menu:*`); при мультикнопочных окнах v1 не поддерживается — окей.
- [Буфер журнала в main растёт памятью] → лимит 500 записей с вытеснением старых (CLI имеет 1000; встроенный короче, журнал живёт только в сессии).
- [Матчинг по первому совпавшему маршруту] → при дублирующихся method+path побеждает первый; документируем в комментарии storage-валидации, не валидируем уникальность в v1.
- [Порт по умолчанию может быть занят] → статус «ошибка» с сообщением и возможностью сменить порт в UI; поведение повторяет MCP.
- [Тело маршрута — raw-строка, JSON не валидируется] → сервер отдаёт как есть с content-type json; невалидный JSON увидит клиент — это осознанный контракт «мок отдаёт ровно то, что настроено».

## Migration Plan

Новые файлы хранилища (`mock-projects.json`, `mock-projects/<id>.json`) создаются по требованию; существующие файлы и settings.json не меняются — миграции данных нет. Откат — просто удаление новых файлов; раскладка вида «Запросы» сохраняется без изменений. After-apply: обновить AGENTS.md (каналы `mocks:*`, push `mocks:log`, файлы хранилища, `mock.js` в архитектуре).

## Open Questions

Нет — ключевые решения подтверждены пользователем (мок-проекты отдельно; один активный сервер; без `/__admin`).
