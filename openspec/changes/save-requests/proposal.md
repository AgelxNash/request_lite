# Proposal

## Why

Модель запроса после change'а send-request полная (params/headers/body/auth/ssl), но живёт только в стейте вкладки и умирает при закрытии. Массив `requests[]` в файле проекта пустует с каркаса. Без сохранения нельзя воспроизводить запросы между запусками — ключевая функция аналога Postman.

## What Changes

- Новые IPC-каналы `requests:list` / `requests:save` / `requests:delete` (upsert по id) и функции хранилища `saveRequest`/`deleteRequest`/`listRequests`.
- Кнопка Save в строке запроса и пункт меню Save Request (`CmdOrCtrl+S`): сохранение снимка вкладки в активный проект. Первое сохранение — диалог имени (предзаполнение из URL), повторное — молча обновляет тот же запрос.
- Связь вкладка↔запрос (`savedRequestId`) и индикатор несохранённых изменений (точка на вкладке).
- Сайдбар: список запросов активного проекта (метод + имя); клик открывает запрос в новой вкладке.
- Удаление запроса из сайдбара (✕ + confirm); открытые вкладки удалённого запроса отвязываются, оставаясь открытыми.
- EPERM-retry в `writeJsonAtomic` — страховка от флейма Windows (антивирус/индексатор держат файл во время rename).

Вне scope: папки/дерево запросов; окружения и `{{var}}`; импорт/экспорт; автосохранение; переупорядочивание запросов.

## Capabilities

### New Capabilities

- `request-storage`: сохранение запроса в активный проект, состав сохранённого запроса, список в сайдбаре, открытие в вкладке, индикатор изменений, удаление.

### Modified Capabilities

- `app-shell`: MODIFIED требования «Редактор и ответ как каркасные зоны» — в строке запроса появляется Save («метод + URL + Save + Send»); сценарий «Состав основной области» обновляется, остальные сохраняются.

## Impact

- `src/main/storage.js` — `saveRequest`/`deleteRequest`/`listRequests`, EPERM-retry в `writeJsonAtomic`.
- `src/main/ipc.js`, `src/preload/index.js` — каналы `requests:*` и `api.requests.*`.
- `src/main/index.js`, `src/renderer/src/App.vue` — пункт меню Save Request.
- `src/renderer/src/stores/tabs.js` — `savedRequestId`, `dirty`, `openSaved`, `saveActive`, отвязка при удалении.
- `src/renderer/src/stores/requests.js` — новый store запросов активного проекта.
- `src/renderer/src/components/` — `RequestList.vue` (новый), `Sidebar.vue`, `RequestEditor.vue` (кнопка Save), `RequestTabs.vue` (дёрти-точка).
- `scripts/smoke.mjs` — тесты CRUD запросов хранилища.
- Зависимости не добавляются. Кроссплатформенность сохраняется (`node:path`/`fs/promises`, `userData`).
