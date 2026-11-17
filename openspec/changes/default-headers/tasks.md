# Tasks

## 1. Дефолтные заголовки

- [x] 1.1 Создать `src/renderer/src/lib/defaults.js` с `DEFAULT_HEADERS` (User-Agent: PostmanLite/1.0, Accept: application/json, Accept-Language: ru-RU,ru;q=0.9 — все `enabled: true`); проверить в smoke: структура `{id-less key/value/enabled}` корректна, `buildRequest` с этими строками отправляет `User-Agent: PostmanLite/1.0` и не дублирует `accept` (echo-сервер в smoke показывает ровно одно значение)
- [x] 1.2 `stores/tabs.js` → `makeTab`: `headers` из `DEFAULT_HEADERS` (с id через счётчик строк) + одна пустая строка; проверить в ручную: новая вкладка содержит 3 заполненные включённые строки и пустую, редактирование/удаление дефолта работают как у обычных строк, удалённый дефолт не возвращается

## 2. Счётчик Headers

- [x] 2.1 `RequestEditor.vue`: бейдж `tab-counter` с числом активных заголовков (включена галочка и непустой ключ) рядом с вкладкой Headers; проверить в ручную: снятие галочки или очистка ключа уменьшают счётчик, как у Params

## 3. Интеграция

- [x] 3.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + новые тесты дефолтов)
- [x] 3.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): новая вкладка показывает дефолты; отправка — сервер получает `user-agent: postmanlite/1.0` и `accept: application/json` без дубликатов; снять галочку с `Accept` — сервер получает автозначение `*/*`; счётчик Headers совпадает с числом включённых

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — обновится MODIFIED-требование «Редактирование заголовков запроса» в `openspec/specs/request-execution/spec.md`.
