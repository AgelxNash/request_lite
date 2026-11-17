# Tasks

## 1. Ядро конвертации (`lib/curl.js`)

- [x] 1.1 Создать `src/renderer/src/lib/curl.js`: `tokenizeShell` (кавычки `'…'`/`"…"`, `\x`, переносы `\`) и `parseCurl(text)` → снимок (флаги `-X/-H/-d/--data-raw/--data-binary/-F/-u/-b/--json/-G/--url`, слитные `-XPOST`/`--request=POST`; `-d` без `-X` → POST; `-G` → данные в query; `-u` → basic; `-b` → Cookie; URL — позиционный или `--url`); проверить в smoke: сценарии спеки (типичная команда, `-d`→POST, `-u`/`-b`, `-G`→params, ошибка без URL), двойные кавычки с `\"`, многострочный перенос `\`
- [x] 1.2 Реализовать `generateCurl(snapshot)` → команда (не-GET → `-X`; bearer/apikey → `-H`, basic → `-u`; json/text → `-d` + Content-Type (если не перекрыт), urlencoded → `--data-urlencode` по паре, form-data → `-F`; экранирование `'` → `'\''`; `{{var}}` литерально; GET/HEAD без тела); проверить в smoke: сценарии спеки (auth+тело, basic, экранирование, литеральные `{{var}}`)
- [x] 1.3 Round-trip smoke: `parseCurl(generateCurl(snapshot))` воспроизводит метод, URL (с params), заголовки, тело, auth для комбинированного снимка (params + headers + bearer + json + urlencoded + basic); проверить: тест зелёный

## 2. Импорт в UI

- [x] 2.1 Создать `components/CurlImportDialog.vue` (textarea моноширинная, кнопка «Импорт», ошибка парсинга красным без создания вкладки); `stores/tabs.js`: action `openTabFromSnapshot(snapshot, name)` (новая вкладка без связи, имя-подсказка из URL или «Imported Request»); проверить в ручную: вставка команды → вкладка с содержимым
- [x] 2.2 `src/main/index.js`: пункт меню «Вставить запрос из cURL» (`CmdOrCtrl+I`) → канал `menu:import-curl`; `src/preload/index.js`: проброс в `onMenu`; `App.vue`: обработчик открывает диалог; проверить в ручную: меню открывает диалог, импорт создаёт вкладку

## 3. Экспорт в UI

- [x] 3.1 `src/main/ipc.js` + `src/preload/index.js`: канал `clipboard:write` (electron `clipboard.writeText` в main); проверить: из renderer текст попадает в системный буфер
- [x] 3.2 Создать `components/CurlExportPanel.vue` (шторка справа поверх области ответа: код-блок с выделением, «Копировать» → `clipboard:write`, закрытие ×/Esc); `RequestTabs.vue`: пункт «Копировать как cURL» в контекстном меню → `generateCurl(toSnapshot(кликнутая вкладка))` → панель; стили; проверить в ручную: ПКМ по неактивной вкладке → панель с её командой, «Копировать», Esc закрывает

## 4. Интеграция

- [x] 4.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + парсер/генератор/round-trip)
- [x] 4.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): вставить реальную команду curl (POST json с bearer) → вкладка → Send: echo подтверждает метод/заголовки/тело; экспорт вкладки через ПКМ → панель → «Копировать» → вставка в терминал выполняется; round-trip через UI: экспортированная команда импортируется в новую вкладку с тем же содержимым

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — создаст capability `curl-exchange` в `openspec/specs/`.
