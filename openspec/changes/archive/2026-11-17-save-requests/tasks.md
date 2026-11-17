# Tasks

## 1. Хранилище и IPC

- [x] 1.1 `src/main/storage.js`: `saveRequest(projectId, request)` (upsert по id, имя непустое, иначе ошибка), `deleteRequest(projectId, requestId)`, `listRequests(projectId)`; EPERM-retry (3 попытки × 50мс) в `writeJsonAtomic`; проверить в smoke: create → save → одна запись в `getProject().requests`, повторный save с тем же id обновляет, delete убирает, list возвращает порядок добавления, persist после повторного `bootstrap`
- [x] 1.2 `src/main/ipc.js` + `src/preload/index.js`: каналы `requests:list|save|delete` и `api.requests.*` (save/delete возвращают обновлённый список); проверить: `npm run dev` стартует без ошибок, каналы по префиксу `requests:*`

## 2. Сайдбар и store запросов

- [x] 2.1 Создать `stores/requests.js` (`items`, `load(projectId)`, `save`, `remove`) и `components/RequestList.vue` (строка «метод + имя», ✕ с confirm, клик → событие open); подключить в `Sidebar.vue` для активного проекта; проверить в ручную: у пустого проекта — пустое состояние с приглашением сохранить запрос
- [x] 2.2 `RequestTabs.vue`: точка-индикатор `dirty` перед именем вкладки; проверить в ручную: точка появляется/исчезает по состоянию вкладки

## 3. Вкладки и сохранение

- [x] 3.1 `stores/tabs.js`: поля `savedRequestId`/`dirty`, `dirty` ставится в `updateActive*`, `openSaved(request)` (новая вкладка из снимка + связь, без dirty), `saveActive()` (диалог имени при первом сохранении — дефолт из URL, upsert через requests store, сброс dirty), `detachSaved(requestId)` (отвязка вкладок); проверить в ручную: круг «заполнил → сохранил → изменил → точка → сохранил → точка исчезла»
- [x] 3.2 `RequestEditor.vue`: кнопка Save слева от Send (`disabled` при отправке или отсутствии активного проекта, title-подсказка); `App.vue` + `src/main/index.js`: пункт меню «Save Request» (`CmdOrCtrl+S`) → `menu:save-request` → `tabs.saveActive()`; проверить в ручную: и кнопка, и Ctrl/Cmd+S сохраняют

## 4. Интеграция

- [x] 4.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + CRUD запросов хранилища)
- [x] 4.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): создать проект → заполнить запрос (params/headers/body/auth) → Save (имя из URL) → запрос в сайдбаре → открыть вторую вкладку этого запроса → Send работает → изменить и сохранить → перезапуск приложения: запрос и содержимое на месте → удалить запрос → вкладка осталась отвязанной → Save создаёт новый запрос

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — создаст `request-storage` и обновит «Редактор и ответ как каркасные зоны» в `app-shell`.
