# Design

## Context

Мотивация — в proposal.md. Сейчас экспорт один: `generateCurl(snapshot)` (`src/renderer/src/lib/curl.js`) строит команду из снимка вкладки (`toSnapshot(tab)`), пункт контекстного меню «Копировать как cURL» (`RequestTabs.vue`) считает текст в момент клика и открывает панель `CurlExportPanel.vue` (код-блок, «Копировать» через `clipboard:write`, Esc). `generateCurl` импортируется и в main — инструмент MCP `export_curl` (`src/main/mcp.js`), поэтому общие помощники остаются чистыми: без DOM и без Node-глобалей, которых нет в renderer.

Ограничения:

- `buildRequest` (`src/main/http.js`) из renderer недоступен: модуль импортирует `undici` (границы слоёв AGENTS.md), бросает `INVALID_URL` на `{{baseUrl}}/…` (шаблонный URL не проходит `new URL`) и кладёт в multipart случайный boundary.
- В снимке `{{var}}` не разрешены — подстановка происходит в момент отправки (`variables.js`).
- Правила построения команды curl менять нельзя: действующая capability `curl-exchange` и требование issue «cURL-генератор не переписываем».

## Goals / Non-Goals

**Goals:**

- Три генератора на одном снимке с общими с curl правилами переноса (URL, заголовки, авторизация, тело) — без дублирования правил.
- Сниппет без `{{var}}` отправляет тот же запрос, что приложение; это проверяется исполнением сниппета в smoke, а не только видом текста.
- Вывод `generateCurl` остаётся байт-в-байт прежним, включая MCP `export_curl`.

**Non-Goals:**

- Байт-в-байт совпадение кодировки urlencoded и multipart на проводе: `URLSearchParams` и `FormData` кодируют при выполнении (пробел → `+`, свой boundary). Контракт — совпадение декодированных пар.
- Живое обновление панели при правке запроса.
- Варианты одной цели (Node/браузер, CommonJS).

## Decisions

### D1. `lib/snippets.js` — чистый модуль рядом с curl
`SNIPPET_LANGS` (список `{ value, label }` для селектора) и `generateSnippet(snapshot, lang)`; неизвестный язык — `Error` с его именем. Один файл без зависимостей (паттерн `curl.js`, `variables.js`), smoke гоняет его в Node. cURL остаётся в `generateCurl`: селектор — `[{ value: 'curl', label: 'cURL' }, ...SNIPPET_LANGS]`, диспетчер в `RequestTabs.vue`.

Альтернатива — строить сниппеты поверх `buildRequest`, как предлагает issue: отклонена по ограничениям из Context. Идея issue используется иначе: `buildRequest` и `sendRequest` — эталон в smoke (D9).

### D2. Общие помощники в `curl.js` при неизменном выводе cURL
Из `generateCurl` выносятся:
- `buildUrlForExport(snapshot)` — уже есть как приватная функция (`curl.js:301`): добавляется `export`, тело не меняется;
- `exportHeaders(snapshot, { carriesBody })` → `[{ key, value }]` — авто Content-Type для json/text, bearer, apikey-заголовок, пользовательские заголовки — в том же порядке, в каком `generateCurl` сейчас выдаёт `-H`. `generateCurl` заменяет этот участок циклом по результату; basic → `-u` остаётся curl-специфичным.

Порядок работ: сначала characterize-тест (точная строка `generateCurl` для составного снимка с params, заголовками, bearer и телом; отдельный случай с пользовательским Content-Type), затем вынос. Существующие проверки `generateCurl` и MCP `export_curl` остаются как есть.

Альтернатива — продублировать ~20 строк правил в `snippets.js` и не трогать `curl.js`: отклонена, правила разъедутся при следующих правках — маскирование секретов (#6) должно попадать во все форматы сразу.

### D3. Что получает генератор
1. `method` — `String(snapshot.method ?? 'GET').toUpperCase()`; `url` — `buildUrlForExport`.
2. `headers` — `exportHeaders(snapshot, { carriesBody })`, где `carriesBody` как в curl (не GET/HEAD и тип тела не `none`).
3. Для urlencoded — авто `Content-Type: application/x-www-form-urlencoded` первым, если пользователь не задал свой. Правило живёт в `snippets.js`, а не в `exportHeaders`: curl его не ставит (`--data-urlencode` — curl выставит сам), и вывод cURL не должен измениться.
4. Для Fetch — заголовок basic-авторизации (D6).
5. Схлопывание дублей имён (D7).

### D4. Формы сниппетов
Один снимок (POST, bearer, json-тело) в трёх целях:

```js
const response = await fetch('{{baseUrl}}/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer t-1'
  },
  body: '{"name":"Ann"}'
});

console.log(response.status, await response.text());
```

```js
import axios from 'axios';

const response = await axios({
  method: 'post',
  url: '{{baseUrl}}/users',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer t-1'
  },
  data: '{"name":"Ann"}'
});

console.log(response.status, response.data);
```

```python
import requests

url = '{{baseUrl}}/users'

headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer t-1'
}

response = requests.post(url, headers=headers, data='{"name":"Ann"}')

print(response.status_code, response.text)
```

Выборы по целям:

- **Fetch.** Top-level `await` (браузерная консоль, Node ≥ 18 ESM). `headers` опускается, если пусто. urlencoded → `const body = new URLSearchParams()` + `append` на пару; form-data → `const body = new FormData()` + `append`. Для multipart `Content-Type` не ставится — клиент добавит его с boundary.
- **Axios.** ESM-импорт: проект и современный код — ESM. `method` в нижнем регистре (как в документации axios). basic → `auth: { username, password }`; urlencoded и form-data → те же `URLSearchParams`/`FormData` в `data`.
- **Python.** `requests.<method>(…)` для методов с короткой формой (`get`, `options`, `head`, `post`, `put`, `patch`, `delete`), иначе `requests.request('<METHOD>', …)`. basic → `auth=('user', 'pass')`; urlencoded → `data={…}`; form-data → `files={'k': (None, 'v')}` — штатный способ отправить текстовое поле как multipart без имени файла.

Альтернатива для тела json — `JSON.stringify({...})` / `json.dumps({...})`, как у Postman: отклонена. Повторная сериализация меняет байты (пробелы, порядок ключей) и падает на невалидном JSON и на шаблонах с `{{var}}`.

### D5. Экранирование литералов
База — `JSON.stringify`: корректный литерал в двойных кавычках, валидный и в JS, и в Python (`\"`, `\\`, `\n`, `\r`, `\t`, управляющие — `\u00XX`; не-ASCII остаётся как есть). Собственные правила экранирования не пишутся — это новый источник ошибок, а Python-парсера в smoke нет.

Разделитель: если в значении нет `'`, литерал выдаётся в одинарных кавычках (JSON-форма с `\"` → `"`), иначе — в двойных. JSON-тело читается как `'{"name":"Ann"}'`, а не `"{\"name\":\"Ann\"}"`; обе формы валидны в обоих языках. Так же экранируются имена заголовков и ключи пар.

Тело json/text — сырая строка снимка, без ре-сериализации (D4).

### D6. Basic-авторизация
У Fetch нет штатной опции — заголовок `Authorization: Basic <base64>`. Base64 считается генератором в UTF-8 (`TextEncoder` + `btoa` — есть и в renderer, и в Node) и совпадает с `Buffer.from(…, 'utf8').toString('base64')` в `buildRequest`. Если в логине или пароле есть `{{var}}`, значение не посчитать — выражение при выполнении: `'Basic ' + btoa('{{user}}:{{pass}}')`. Axios и Python получают логин и пароль через штатные опции, заголовок считает клиент.

Альтернатива — всегда runtime-выражение: отклонена, `btoa` не умеет не-Latin-1 (кириллический логин) — в частом случае без переменных не 1:1.

### D7. Дубликаты имён заголовков
Сниппет — литерал объекта/dict: повтор имени без учёта регистра схлопывается, побеждает последний (пользовательский заголовок перекрывает авторский и автоматический). Клиенты при выполнении нормализуют имена так же, поэтому сниппет одинаков для трёх языков. cURL-экспорт дубликаты не схлопывает (отдельные `-H`) и не меняется.

### D8. UI
- `RequestTabs.vue`: пункт «Сгенерировать код»; при клике `codePanelSnapshot = toSnapshot(tab)` и панель открывается. `codePanelLang = ref('curl')` живёт в компоненте, пока приложение запущено, — без persist в settings (предпочтение сессии, как `view` в `stores/ui.js`). Текст панели — computed от снимка и языка.
- Снимок фиксируется при открытии — как сегодня фиксировался текст: переключение языка перегенерирует для того же снимка, правки вкладки на показанный код не влияют.
- `CurlExportPanel.vue`: props `visible`, `text`, `lang`, `langs`; события `close`, `update:lang`. В шапке вместо заголовка «cURL» — `<select class="pane-select">`. «Копировать», × и Esc без изменений. Файл и классы `.curl-*` не переименовываются: правка точечная, переименование — отдельная чистка.
- Вторых входов (меню «Файл», строка запроса) нет — одно место, решено на этапе планирования.

### D9. Стратегия проверок
- **Золотые тексты.** Точный текст каждого из трёх сниппетов для канонического снимка — фиксирует формат.
- **Фиксация вывода cURL (characterize-тест).** До выноса помощников (D2).
- **Исполнение Fetch-сниппета.** Снимок без `{{var}}`, сниппет загружается как ES-модуль из `data:`-URL (top-level `await` работает) и выполняется против echo-сервера smoke (`scripts/smoke.mjs:851`). Echo `{method, url, headers, body}` сравнивается с echo от `http.sendRequest` того же снимка; для multipart — по декодированным полям. В Node 24 `fetch`, `FormData`, `URLSearchParams`, `btoa`, `TextEncoder` глобальные.
- **Axios.** Пакета в зависимостях нет и не появится — синтаксическая проверка: без строки `import` код парсится как тело async-стрелки через `new Function`.
- **Python.** Парсера в Node нет — золотые тексты и кейсы экранирования; синтаксис дополнительно проверяется вручную (`python3 -c "import ast, sys; ast.parse(sys.stdin.read())"`).

## Risks / Trade-offs

- [Браузер отбрасывает запрещённые заголовки — `User-Agent` (`DEFAULT_HEADERS`), `Cookie`, `Referer`] → в браузере fetch-сниппет по ним не 1:1, в Node — 1:1 (smoke проверяет Node). Заголовки из сниппета не вычищаются: код показывает запрос целиком. Ограничение фиксируется в README.
- [CORS при запуске fetch/axios в браузере] → свойство браузера, не сниппета; упоминание в README.
- [`{{var}}` литерально — сниппет не запускается без ручной замены] → требование issue (критерий 2); заодно значения переменных не покидают приложение через буфер обмена.
- [Runtime `btoa` для basic с `{{var}}` не умеет не-Latin-1] → редкий случай; без переменных генератор считает в UTF-8.
- [`URLSearchParams` кодирует пробел как `+`, приложение — `%20`; у `FormData` свой boundary] → декодированные значения совпадают, smoke сравнивает по ним.
- [Вынос `exportHeaders` может изменить вывод cURL] → characterize-тест до выноса, существующие проверки, регрессия MCP `export_curl`.
- [Дубликаты заголовков теряются в сниппетах] → осознанно (D7); форматом без потерь остаётся cURL.

## Migration Plan

Не требуется: новый модуль и точечные правки UI, формат хранения и IPC не меняются.

## Open Questions

Нет.
