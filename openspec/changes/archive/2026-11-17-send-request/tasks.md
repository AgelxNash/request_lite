# Tasks

## 1. Сборка и выполнение запроса в main (`src/main/http.js`)

- [x] 1.1 Добавить prod-зависимость `undici` (для Agent с `rejectUnauthorized: false`) и проверить установку: `npm install` проходит, `node -e "import('undici').then(m => console.log(typeof m.Agent))"` печатает `function`
- [x] 1.2 Реализовать `buildRequest(snapshot)`: мерж params → query через `new URL` + `searchParams.append` (дубликаты разрешены, существующий query сохраняется), ошибка `INVALID_URL` на невалидный URL; проверить в smoke: параметры дописаны, отключённые и с пустым ключом пропущены, невалидный URL даёт `INVALID_URL`
- [x] 1.3 Реализовать конвертацию auth в `buildRequest`: bearer → `Authorization: Bearer <token>`, basic → `Buffer.from('login:pass').toString('base64')`, apikey → заголовок или query-параметр по placement; проверить в smoke все четыре сценария спеки (значения как в `specs/request-execution/spec.md`)
- [x] 1.4 Реализовать сборку body: json (Content-Type `application/json`), urlencoded (`key=value&...`, `application/x-www-form-urlencoded`), text (`text/plain`), none (без тела); проверить в smoke точные тела и Content-Type
- [x] 1.5 Реализовать ручную сборку multipart для form-data (граница `----postmanlite<uuid>`, CRLF, размер через `Buffer.byteLength`); проверить в smoke: временный http-сервер парсит поля формы, Content-Type содержит границу
- [x] 1.6 Реализовать `sendRequest(snapshot, requestId)`: один AbortController (таймаут 30с → причина `timeout`, отмена → `cancel`), тело ответа до 10 МБ с `truncated: true`, `TextDecoder` c `fatal: false`, коды ошибок `TIMEOUT`/`ABORTED`/`NETWORK`/`SSL`; проверить в smoke: успешный ответ со статусом/временем/заголовками/телом, отмена по AbortController, обрез тела (сервер отдаёт > 10 МБ), ошибка сети на закрытом порту; таймаут проверить с инъекцией короткого таймаута-параметра (без ожидания 30с)

## 2. IPC и preload

- [x] 2.1 Зарегистрировать `http:request` (`{requestId, request}` → `{ok, response}` / `{ok: false, error: {code, message}}`) и `http:cancel` в `src/main/ipc.js`; map `requestId → controller` чистится в `finally`; проверить: `npm run dev` стартует без ошибок регистрации, каналы следуют префиксу `http:*`
- [x] 2.2 Добавить в `src/preload/index.js` мост `window.api.http.{send, cancel}`; проверить: вызовы из DevTools renderer доходят до main (лог в обработчике), `window.api.http.send({})` на пустом снимке возвращает `INVALID_URL`

## 3. Стейт вкладки и редактор запроса (renderer)

- [x] 3.1 Расширить `stores/tabs.js`: поля `params[]/headers[]/body/auth/sslVerify` с дефолтами, строки KV `{id, key, value, enabled}`, runtime-флаг `sending` и `response` на вкладке, снимок для отправки (JSON round-trip); проверить: создание вкладки даёт полную модель, редактирование не теряется при переключении вкладок
- [x] 3.2 Создать `components/KeyValueTable.vue` (галочки enabled, автодобавление пустой строки при вводе в последнюю, placeholder'ы, emits `update:rows`); проверить в ручную: ввод в последнюю строку добавляет новую, снятие галочки помечает строку неактивной
- [x] 3.3 Заполнить таб Params (KV-таблица + счётчик активных) и Headers (KV-таблица) в `RequestEditor.vue`; проверить: счётчик совпадает с числом включённых строк с непустым ключом
- [x] 3.4 Заполнить таб Body: селектор типа `none|json|form-data|urlencoded|text`, textarea для json/text, KV-таблицы для form-data/urlencoded; проверить: переключение типа сохраняет ранее введённые данные каждого слота
- [x] 3.5 Заполнить таб Auth: селектор `none|bearer|basic|apikey`, поля под тип, для apikey — placement header/query; проверить: смена типа показывает только релевантные поля
- [x] 3.6 Оживить Send/Cancel и toggle sslVerify: Send активен при непустом URL, при отправке меняется на Cancel, вызов `api.http.send/cancel`, ответ пишется в `tab.response`; проверить в ручную: `npm run dev` → запрос на echo-сервер уходит, Cancel прерывает долгий запрос
- [x] 3.7 Создать `lib/format.js`: pretty-print валидного JSON, токенизация в безопасный HTML (escape до вставки), сырой текст для невалидного; проверить в smoke (модуль чистый Node): XSS-строка в значении экранируется, валидный JSON форматируется

## 4. Отображение ответа (`ResponseView.vue`)

- [x] 4.1 Показать статус-строку (код, время, размер), заголовки ответа и тело; JSON — подсветка из `format.js`, не-JSON — текст; пометка при `truncated`; пустое состояние до отправки; проверить в ручную: echo-сервер возвращает JSON и text/plain — оба варианта отображаются корректно
- [x] 4.2 Показать ошибки по кодам: `TIMEOUT`, `ABORTED` (метка «Отменено»), `NETWORK`, `SSL`, `INVALID_URL` с понятным текстом; проверить в ручную: запрос на закрытый порт даёт сообщение об ошибке сети, Send возвращается активным

## 5. Интеграция

- [x] 5.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты хранилища + новые тесты сборки/выполнения/формата)
- [x] 5.2 Ручной e2e на echo-сервере (`node scripts/echo-server.mjs` + `npm run dev`): GET с params и headers, POST json / form-data / urlencoded / text, все типы auth (echo отражает полученные заголовки и query), Cancel на долгом запросе, переключение вкладок не теряет ответы
- [x] 5.3 Проверить `sslVerify`: echo-server по HTTPS (временный self-signed сертификат) — при выключенной проверке запрос проходит, при включённой — ошибка SSL

## Workflow follow-up

- После приёмки: sync-specs или archive change (openspec-archive-change), проверить, что `app-shell` получил изменённое требование, а `request-execution` появился в `openspec/specs/`.
