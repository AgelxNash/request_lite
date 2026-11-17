# Proposal

## Why

Postman — основной источник существующих коллекций: переход в приложение требует переноса наработок. Ручной перенос (перепечатка запросов и переменных) — hours of error-prone work; импорт v2.x JSON делает миграцию одной операцией. Это последний крупный пункт, предписанный AGENTS.md: коллекция → новый проект, папки → префиксы имён, raw/urlencoded/formdata (без файлов), `collection.variable` → окружение с именем коллекции.

## What Changes

- Новый чистый модуль `lib/postman.js`: `parseCollection(text)` → `{name, requests[], variables[]}` — разбор Postman Collection v2.x JSON: item-дерево (вложенные папки → имена «Folder / Sub / Req»), метод, URL (object `{raw, query[]}` — query → params с учётом disabled), headers (с disabled), auth запроса (bearer/basic/apikey) с наследованием collection-level auth, body (`raw` c `lang:json` → json, иначе text; `urlencoded`; `formdata` — файл-поля с литеральным значением `@src`; `file`/`graphql` — вне поддержки, тело none).
- Bulk-импорт в main: канал `projects:importCollection {name, requests, variables}` — создание проекта, requests[] и окружения (имя коллекции, `activeEnvId` на него) одной атомарной записью; проект становится активным.
- UI: пункт меню «Файл → Импорт коллекции Postman» → file picker (`dialog.showOpenDialog`, JSON) в main → чтение файла → парсинг в renderer → ошибки разбора показываются без создания проекта.
- Smoke-тесты: fixture-коллекция (вложенные папки, все body-режимы, disabled-поля, auth, переменные), ошибки (не-JSON, не коллекция).

Вне scope: импорт окружений Postman (отдельные files), v1.x форматов, тестов/скриптов/событий Postman, файлов в formdata (литерал `@src`), граф GraphQL-тел, WebSocket-запросы, дедупликация при повторном импорте.

## Capabilities

### New Capabilities

- `postman-import`: импорт коллекции Postman v2.x из файла в новый проект — конвертация дерева запросов (папки-префиксы, поля, auth, тела) и переменных в окружение.

### Modified Capabilities

(нет — создание проектов и окружений покрывают существующие capabilities; импорт добавляет новый путь ввода данных)

## Impact

- `src/renderer/src/lib/postman.js` — новый чистый модуль (парсер).
- `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/App.vue` — пункт меню, канал `menu:import-postman`, диалог.
- `src/main/ipc.js`, `src/main/storage.js` — `postman:pickAndRead` (file picker + чтение), `projects:importCollection` (bulk: проект + запросы + окружение), `importCollection` в хранилище (одна атомарная запись).
- `src/renderer/src/components/PostmanImportDialog.vue` — новый диалог статуса/ошибки.
- `scripts/smoke.mjs` — тесты парсера и bulk-импорта.
- Зависимости не добавляются.
