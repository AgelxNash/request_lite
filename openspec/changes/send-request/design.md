# Design

## Context

Каркас готов: вкладка в `stores/tabs.js` несёт только `{id, name, method, url}`, табы редактора и ResponseView — заглушки, Send отключён. В main-процессе нет HTTP-модуля; IPC покрывает `projects:*`, `settings:*`, `data:*`. Установившийся паттерн: модули main не зависят от Electron и импортируются smoke-тестами (так устроен `storage.js`) — воспользуемся им же для логики сборки запроса.

## Goals / Non-Goals

**Goals:**
- Чистая, тестируемая в Node сборка запроса (params → URL, auth → headers/query, body → multipart/urlencoded/json/text) и её выполнение через `fetch`.
- Cancel и таймаут без гонок: один AbortController на запрос, причина отмены различается.
- UI как в Postman: KV-таблицы с галочками и автодобавлением строк, счётчик активных params, JSON-подсветка ответа.

**Non-Goals:**
- Файлы в form-data, переменные/окружения, persist запросов, curl/Postman импорт, управление редиректами (fetch следует по умолчанию), cookie-jar, прокси.

## Decisions

### D1. Стейт вкладки и снимок запроса
Вкладка обрастает полями: `{id, name, method, url, params[], headers[], body, auth, sslVerify}`. Строки KV — `{id, key, value, enabled}` (`id` нужен как `:key` в Vue и для стабильности строк). Body — `{type: 'none'|'json'|'form-data'|'urlencoded'|'text', json, form[], urlencoded[], text}`. Auth — `{type, token, username, password, key, value, placement}`. По Send вкладка сериализуется (JSON round-trip) в снимок и уходит в IPC — реактивные Proxy в IPC не передать.

### D2. Сборка запроса — чистая функция в `src/main/http.js`
`buildRequest(snapshot)` → `{url, headers, body}` и `sendRequest(...)` → ответ/ошибка. Сборка живёт в main, а не в renderer-lib, потому что: (а) smoke-тесты импортируют модули main напрямую в чистом Node, как `storage.js`; (б) auth-конвертация и multipart — часть «момента отправки», за которую отвечает main по архитектурным правилам. Renderer присылает только сырой снимок.

### D3. multipart собирается вручную
Тело form-data — строка с разделителями CRLF и границей `----postmanlite<uuid>`, размер через `Buffer.byteLength`. Без npm-зависимостей (правило проекта). Так как файлов нет, проблемы бинарного кодирования отсутствуют.

### D4. sslVerify — `undici` Agent через опцию `dispatcher`
При выключенной проверке — `fetch(url, { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) })`. Node/Electron не экспортирует undici-классы из встроенных модулей, поэтому добавляется prod-зависимость `undici` (только main-процесс). Альтернативы отклонены: `NODE_TLS_REJECT_UNAUTHORIZED=0` — глобальный побочный эффект на все запросы процесса; `https.Agent` — несовместим с undici-fetch (у него другой интерфейс диспетчера). Обычный `fetch` без dispatcher, когда проверка включена. Electron 45 несёт Node 22 — глобальный `fetch` и опция `dispatcher` гарантированы.

### D5. IPC-контракт
`http:request` → `handle(event, {requestId, request})`, возвращает `{ok: true, response}` либо `{ok: false, error: {code, message}}`. `response = {status, statusText, timeMs, size, headers: [{key, value}], body, truncated}`. Коды ошибок: `INVALID_URL`, `TIMEOUT`, `ABORTED`, `NETWORK`, `SSL`. `http:cancel` → `(event, requestId)`: abort контроллера из map `requestId → controller`; map чистится по завершении запроса. `requestId` генерирует renderer (`crypto.randomUUID`).

### D6. Таймаут и отмена — один AbortController
На запрос один контроллер: `setTimeout(() => controller.abort('timeout'), 30000)`; пользовательский Cancel делает `controller.abort('cancel')`. Причину читаем в обработчике `abort`/в catch — различаем `TIMEOUT` и `ABORTED`. Альтернатива `AbortSignal.any([timeout, user])` (доступна в Node 22) отклонена как избыточная: один контроллер проще и покрывает оба случая.

### D7. Сборка URL
`new URL(snapshot.url)`; query-параметры добавляются `searchParams.append` (дубликаты ключей разрешены, как в Postman; существующий query в URL сохраняется). Невалидный URL → `INVALID_URL` до fetch. Пустой URL блокирует Send на стороне UI.

### D8. KV-таблица — один компонент
`KeyValueTable.vue` (rows + placeholder'ы, emits `update:rows`) используется в Params, Headers, form-data, urlencoded. Автодобавление пустой строки внизу при вводе в последнюю — как в Postman.

### D9. JSON-подсветка — `lib/format.js` без зависимостей
Валидный JSON — `JSON.parse` + `stringify(, 2)` + токенизация регэкспом в безопасный HTML (`escape` до вставки, `v-html`). Невалидный JSON — сырой текст. Тело ответа декодируем `TextDecoder` с `fatal: false` — обрез по 10 МБ не порвёт многобайтовый символ критично.

### D10. Состояние отправки в UI
На вкладке runtime-флаг `sending` (не сохраняется): Send → Cancel, повторный Send заблокирован. Send активен только при непустом URL. Ответ привязывается к вкладке (`tab.response`), переключение вкладок не теряет результат.

## Risks / Trade-offs

- [Граница обреза 10 МБ внутри multipart-ответа или JSON-строки] → тело после обреза помечается `truncated: true`, подсветка JSON отключается, если парсинг после обреза невалиден.
- [Non-latin логин/пароль в Basic] → base64 считается в main через `Buffer.from('login:pass').toString('base64')`, не `btoa`.
- [Undici Agent не освобождает соединения при частых запросах] → Agent создаётся на запрос с выключенным SSL и отбрасывается после; объём локальный, приемлемо.
- [Гонка Cancel и завершения запроса] → abort на уже завершённый контроллер безвреден; map чистится в `finally` обработчика `http:request`.
- [Electron-специфика `fetch` в packaged-сборке] → smoke-тесты гоняют сборку в чистом Node 18+, e2e на echo-сервере проверяет реальную отправку в Electron до сдачи.

## Migration Plan

Не требуется: хранилище не меняется, данных о запросах пока нет; откат — revert change'а.

## Open Questions

Нет — решение про `undici` зафиксировано (D4), остальное покрыто AGENTS.md и спекой.
