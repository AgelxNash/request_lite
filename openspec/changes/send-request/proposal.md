# Proposal

## Why

Каркас приложения показывает неактивную кнопку Send и пустые вкладки Params/Headers/Body/Auth — приложение пока ничего не делает с HTTP. Отправка запросов — ядро аналога Postman, и без неё остальные функции (сохранение запросов, окружения, импорт) не имеет смысла наращивать: нечего сохранять и импортировать.

## What Changes

- Стейт вкладки запроса расширяется: `params[]`, `headers[]`, `body`, `auth`, `sslVerify` вместо текущих `{id, name, method, url}`.
- Редактор запроса наполняется: KV-таблицы для Params/Headers/form-data/urlencoded, редакторы json/text, выбор типа Body (`none | json | form-data | urlencoded | text`), выбор Auth (`none | bearer | basic | apikey`) с placement для apikey (header | query), toggle sslVerify.
- Новый `src/main/http.js` — выполнение запросов ТОЛЬКО в main-процессе: Node `fetch`, AbortController для Cancel, таймаут 30с, лимит тела ответа 10МБ, `rejectUnauthorized: false` при выключенном sslVerify.
- Новые IPC-каналы `http:request` / `http:cancel`; `window.api.http.*` в preload.
- ResponseView показывает статус/время/размер, заголовки ответа и тело с JSON-подсветкой (собственный лёгкий `lib/format.js`, без зависимостей).
- Подсветка и счётчики в таблицах Params (сколько активных параметров попадёт в URL) как в Postman.
- Smoke-тесты: сборка запроса в чистом Node (params → query, auth → заголовки/query, body → multipart/urlencoded/json) на временном http-сервере.

Вне scope (отдельные изменения): сохранение запросов в `requests[]` проекта и каналы `requests:*`; окружения и подстановка `{{var}}`; curl-импорт/экспорт; импорт Postman-коллекций; файлы в form-data; двусторонняя синхронизация Params ↔ URL.

## Capabilities

### New Capabilities

- `request-execution`: составление запроса (params/headers/body/auth), его выполнение в main-процессе, конвертация auth и body в момент отправки, отмена, отображение ответа.

### Modified Capabilities

- `app-shell`: требование «Редактор и ответ как каркасные зоны» теряет каркасные сценарии («Send неактивна», «пустые состояния») — вкладки редактора становятся рабочими, поведение описывает `request-execution`; в `app-shell` остаётся только раскладка зон.

## Impact

- `src/main/http.js` — новый модуль выполнения (main-процесс).
- `src/main/ipc.js` — каналы `http:request`/`http:cancel` (расширение префикса `http:*`).
- `src/preload/index.js` — мост `window.api.http.{send, cancel}`.
- `src/renderer/src/stores/tabs.js` — стейт вкладки: параметры, заголовки, тело, auth, ssl.
- `src/renderer/src/components/RequestEditor.vue`, `ResponseView.vue` — наполнение каркасных зон; новый KV-таблица-компонент.
- `src/renderer/src/lib/format.js` — новый: JSON-подсветка/форматирование.
- `scripts/smoke.mjs` — новые тесты сборки запроса; `scripts/echo-server.mjs` — ручной e2e.
- Зависимости не добавляются (multipart собирается вручную, JSON-подсветка своя).
