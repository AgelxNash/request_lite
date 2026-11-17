# Tasks

## 1. Парсер (`lib/postman.js`)

- [x] 1.1 Создать `src/renderer/src/lib/postman.js`: `parseCollection(text)` — JSON.parse + валидация структуры (`info.name`, `item[]`), рекурсивный обход item-дерева с папками-префиксами « / », конвертация URL (string|object, query → params с disabled), headers (disabled), auth (bearer/basic/apikey, наследование collection-level), body (raw+lang:json → json, urlencoded, formdata с файл-литералом `@src`, file/graphql → none), `collection.variable` → variables; проверить в smoke: сценарии спеки (типичный импорт, папки/вложенность, query/disabled, headers, тела, auth+наследование, file/graphql → none), ошибки (не-JSON, нет info.name/item)
- [x] 1.2 Fixture-коллекция для тестов (в smoke.mjs как константа): вложенные папки, все body-режимы, disabled-поля, collection-level auth, переменные — используется тестами 1.1; проверить: все сценарии спеки покрыты fixture'ом

## 2. Хранилище и IPC

- [x] 2.1 `src/main/storage.js`: `importCollection({name, requests, variables})` — проект в индексе + файл проекта с requests[], окружением (имя коллекции, variables) и `activeEnvId` одной атомарной записью, возвращает проект; проверить в smoke: bulk-импорт даёт проект с запросами и активным окружением, persist между bootstrap
- [x] 2.2 `src/main/ipc.js`: `postman:pickAndRead` (dialog.showOpenDialog JSON + readFile, `{ok, content}` / `{ok: false, cancelled|error}`) и `projects:importCollection` → `storage.importCollection`; `src/preload/index.js`: `api.postman.pickAndRead`, `api.projects.importCollection`; проверить: `npm run dev` стартует, каналы по префиксам

## 3. UI

- [x] 3.1 `src/main/index.js`: пункт меню «Импорт коллекции Postman» → канал `menu:import-postman`; `src/preload/index.js`: проброс; `App.vue`: обработчик — pickAndRead → parse → успех: `projects.importCollection` (проект активен, environments перезагружены) → ошибка: alert-диалог с сообщением; `AppDialog.vue`: добавить alert-мод (message + одна кнопка); проверить в ручную: отмена выбора — ничего, ошибка разбора — диалог, успех — проект активен с окружением

## 4. Интеграция

- [x] 4.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + парсер + bulk-импорт)
- [x] 4.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): fixture-коллекция с baseUrl=localhost:4545 сохраняется во временный JSON → импорт через настоящее меню (osascript) → проект активен, запросы с префиксами папок → окружение активно → открыть импортированный запрос с `{{baseUrl}}` → Send: echo подтверждает метод/headers/тело; ошибка: выбрать не-JSON файл → сообщение без создания проекта

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — создаст capability `postman-import` в `openspec/specs/`.
