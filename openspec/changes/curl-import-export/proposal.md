# Proposal

## Why

curl — универсальный язык обмена HTTP-запросами: команды из документации API, терминала и багрепортов переносятся в клиент копипастой. Без импорта пользователь перепечатывает команды вручную; без экспорта не может передать запрос коллеге или в багрепорт.

## What Changes

- Новый чистый модуль `lib/curl.js`: `parseCurl(command)` (shell-токенизация: одинарные/двойные кавычки, обратный слеш, переносы `\`; флаги `-X/-H/-d/--data-raw/--data-binary/-F/-u/-b/--json/-G/--url` и слитные формы `-XPOST`, `--request=POST`; при `-d` без `-X` метод POST; `-G` — GET с данными в query; `-u` → basic; `-b` → заголовок Cookie) и `generateCurl(snapshot)` (не-GET → `-X`; bearer/apikey → `-H`, basic → `-u`; json/text → `-d` с Content-Type, urlencoded → `--data-urlencode` по паре, form-data → `-F`; одинарные кавычки с экранированием `'` → `'\''`). Переменные `{{var}}` — литерально в обе стороны.
- Импорт: пункт меню «Файл → Вставить запрос из cURL» → диалог с textarea → парсинг → запрос открывается **новой несвязанной вкладкой** (имя — подсказка из URL, сохранение пользователь делает сам). Ошибка парсинга/нет URL — понятное сообщение в диалоге.
- Экспорт: пункт «Копировать как cURL» в контекстном меню вкладки (любая вкладка через ПКМ) → справа выезжает панель (шторка) с командой в код-блоке: текст выделяется, кнопка «Копировать» пишет в буфер через main (`clipboard:write` IPC).
- Smoke-тесты: разбор всех флагов, round-trip `parseCurl(generateCurl(x))` воспроизводит снимок, генерация экранирует кавычки.

Вне scope: файлы в `-F name=@path` (поле импортируется с литеральным значением `@path`); не-http протоколы; прочие флаги curl (сжатие, вывод, TLS-флаги) игнорируются парсером; импорт из файлов/Paste-JSON; экспорт в других форматах.

## Capabilities

### New Capabilities

- `curl-exchange`: преобразование запроса в команду curl и обратно — парсинг команды в снимок запроса (импорт в новую вкладку) и генерация команды из снимка (экспорт в панель с копированием).

### Modified Capabilities

(нет — пункты меню «New Project и Open data folder» в `app-shell` не исчерпывающий список; поведение импорта/экспорта описывает новая capability)

## Impact

- `src/renderer/src/lib/curl.js` — новый чистый модуль (парсер + генератор).
- `src/main/index.js`, `src/renderer/src/App.vue`, `src/preload/index.js` — пункт меню, канал `menu:import-curl`.
- `src/renderer/src/components/CurlImportDialog.vue` — новый диалог импорта (textarea + ошибка).
- `src/renderer/src/components/CurlExportPanel.vue` — новая панель-шторка (код-блок + «Копировать»).
- `src/renderer/src/components/RequestTabs.vue` — пункт контекстного меню.
- `src/main/ipc.js`, `src/preload/index.js` — `clipboard:write` (electron `clipboard` в main).
- `scripts/smoke.mjs` — тесты парсера/генератора/round-trip.
- Зависимости не добавляются.
