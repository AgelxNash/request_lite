# Proposal

## Why

cURL — не единственный язык, в котором нужен запрос: фронтенду нужен `fetch` или axios, бэкенду — Python. Сейчас единственный экспорт — команда cURL (`generateCurl`), остальное пользователь переписывает вручную и по дороге теряет авторизацию, заголовки или тело. Сниппеты кода — первая задача roadmap (issue #1, п. 1): у офлайн-first альтернатив они уже есть, а у нас используют готовые слои — снимок запроса и панель экспорта.

## What Changes

- Новый чистый модуль `lib/snippets.js`: `generateSnippet(snapshot, lang)` для трёх целей — JavaScript `fetch`, JavaScript axios (ESM), Python `requests`. Вход — тот же снимок, что у `generateCurl`: метод, URL с params, заголовки, авторизация (заголовок или штатная опция клиента), тело по типу (json/text — сырой строкой, urlencoded и form-data — парами), GET/HEAD без тела. Переменные `{{var}}` — литерально, строковые литералы экранированы.
- Общие помощники экспорта в `lib/curl.js`: `buildUrlForExport` (URL с params и apikey-in-query) и `exportHeaders` (авто Content-Type, bearer/apikey, пользовательские заголовки) — их использует и `generateCurl`. Вывод cURL не меняется.
- Пункт контекстного меню вкладки «Копировать как cURL» переименован в «Сгенерировать код»; панель экспорта получает селектор языка (cURL по умолчанию, затем Fetch, Axios, Python requests). «Копировать», × и Esc работают как раньше.
- Smoke-тесты: золотые тексты сниппетов, экранирование, литеральные `{{var}}`, basic auth, дубли заголовков; fetch-сниппет исполняется против echo-сервера smoke и сверяется с тем, что отправляет `sendRequest`.

Вне scope: маскирование секретов (#6) — сниппеты содержат те же значения, что и cURL-экспорт; MCP-инструмент для сниппетов (`export_curl` не меняется); отключённая проверка SSL (`sslVerify: false` не отражается — как и в cURL-экспорте); прочие языки и варианты (Go, PHP, C#, CommonJS); файлы в form-data (#7); подстановка значений активного окружения вместо `{{var}}`.

## Capabilities

### New Capabilities

- `code-snippets`: генерация кода запроса на языках клиента (JavaScript fetch, JavaScript axios, Python requests) из снимка запроса — правила переноса метода, URL, заголовков, авторизации и тела, экранирование, литеральные переменные.

### Modified Capabilities

- `curl-exchange`: пункт меню «Копировать как cURL» заменяется на «Сгенерировать код» (правила построения команды curl не меняются); панель экспорта получает селектор языка и перегенерирует текст при переключении.

## Impact

- `src/renderer/src/lib/snippets.js` — новый чистый модуль (генераторы сниппетов).
- `src/renderer/src/lib/curl.js` — экспорт общих помощников `buildUrlForExport`, `exportHeaders`; `generateCurl` переходит на них без изменения вывода.
- `src/renderer/src/components/RequestTabs.vue` — пункт меню «Сгенерировать код», снимок кликнутой вкладки и выбранный язык панели.
- `src/renderer/src/components/CurlExportPanel.vue`, `src/renderer/src/assets/style.css` — селектор языка в шапке панели.
- `scripts/smoke.mjs` — блок проверок сниппетов и золотой вывод `generateCurl`.
- `README.md`, `AGENTS.md` — новый пункт меню, `lib/snippets.js`, число проверок smoke.
- Не затрагивает: `src/main/*`, IPC, preload, хранилище, MCP-инструменты. Зависимости не добавляются.
