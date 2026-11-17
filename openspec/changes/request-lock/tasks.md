# Tasks

## 1. Хранилище и IPC

- [x] 1.1 `src/main/storage.js`: `setRequestLocked(projectId, requestId, locked)` (валидация: запрос существует, boolean) возвращает обновлённый список; guard в `saveRequest` — upsert существующего заблокированного запроса отклоняется с ошибкой «Запрос заблокирован» до мутаций (создание нового id — свободно); guard в `deleteRequest` — locked → ошибка; проверить в smoke: save существующего заблокированного отклоняется и запись неизменна, создание нового свободно, delete отклоняется, setLocked персистентен между bootstrap
- [x] 1.2 `src/main/ipc.js` + `src/preload/index.js`: канал `requests:setLocked {projectId, requestId, locked}` → обновлённый список, `api.requests.setLocked`; проверить: `npm run dev` стартует, канал по префиксу `requests:*`

## 2. UI сайдбара и вкладок

- [x] 2.1 `stores/requests.js`: action `setLocked(requestId, locked)` (обновляет items из ответа); `RequestList.vue`: кнопка-замок 🔓/🔒 в actions строки запроса (confirm обе стороны через dialog), 🔒-индикатор у имени, ✕ `:disabled` + `title="Запрос заблокирован"`; стили индикатора; проверить в ручную: блокировка с подтверждением, индикатор, неактивная ✕, отмена диалога ничего не меняет
- [x] 2.2 `RequestEditor.vue`: `canSave` false при связи активной вкладки с заблокированным запросом, tooltip «Запрос заблокирован — разблокируйте, чтобы сохранить»; `RequestTabs.vue`: пункт меню «Сохранить» disabled с той же подсказкой; `stores/tabs.js` → `saveTab`: ранний return false при связи с заблокированным запросом (дубль-guard для CmdOrCtrl+S); проверить в ручную: Save и пункт меню неактивны для связанной вкладки, клон сохраняется свободно

## 3. Интеграция

- [x] 3.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + guard'ы запросов)
- [x] 3.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): сохранить запрос → заблокировать (confirm) → индикатор, ✕ и Save неактивны, правка вкладки даёт dirty, но Save не работает → guard через api → перезапуск: блокировка на месте → разблокировать (confirm) → Save и удаление работают; клон заблокированного сохраняется как новый запрос

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — влит ADDED «Блокировка запроса», ADDED «Удаление заблокированного запроса» и MODIFIED «Сохранение запроса в активный проект» в `openspec/specs/request-storage/spec.md`.
