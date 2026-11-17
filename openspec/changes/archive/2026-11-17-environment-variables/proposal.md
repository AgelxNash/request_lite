# Proposal

## Why

Запросы содержат `{{baseUrl}}`-подобные плейсхолдеры, но подстановки нет: в разных окружениях (dev/stage/prod) один и тот же запрос требует ручной правки URL и заголовков. Схема файла проекта (`environments[]`, `activeEnvId`) заложена с каркаса и пустует; селектор окружения в тулбаре — неактивный каркасный.

## What Changes

- Модель `Environment {id, name, variables: [{id, key, value, enabled}]}` в файле проекта; каждый environment принадлежит своему проекту, глобальных окружений нет.
- Хранилище: `saveEnvironment` (upsert), `deleteEnvironment`, `setActiveEnvironment` (`activeEnvId` персистентен per project); IPC `environments:list|save|delete|setActive` с возвратом обновлённого списка.
- Тулбар: селектор окружения оживает (окружения активного проекта + «No Environment»), рядом кнопка-шестерёнка → диалог управления (список окружений: создать/удалить с confirm; редактор: имя + KV-таблица переменных с галочками — реюз `KeyValueTable`).
- Подстановка в момент отправки (renderer, перед IPC): чистый `lib/variables.js` — глобальный `\{\{имя\}\}` в URL, params (ключ и значение), headers (ключ и значение), body (json/text и значения urlencoded/form-data); только `enabled`-переменные; неразрешённые плейсхолдеры остаются как есть; без рекурсии. `http.js` не меняется — получает уже подставленные значения.
- Активное окружение хранится per project: переключение проекта восстанавливает его собственный выбор.

Вне scope: глобальные окружения, наследование/приоритеты между окружениями, вложенная подстановка (значение, содержащее `{{...}}`), скрипты и динамические переменные, автоподстановка в редакторе запроса (пользователь видит `{{var}}` литерально).

## Capabilities

### New Capabilities

- `environment-variables`: окружения проекта (CRUD, выбор активного), подстановка `{{var}}` в момент отправки.

### Modified Capabilities

- `app-shell`: MODIFIED требования «Окно и раскладка в стиле Postman» — селектор окружения в тулбаре перестаёт быть «неактивным каркасным»: показывает окружения активного проекта и «No Environment».

## Impact

- `src/main/storage.js` — `saveEnvironment`/`deleteEnvironment`/`setActiveEnvironment`.
- `src/main/ipc.js`, `src/preload/index.js` — каналы `environments:*`, `api.environments.*`.
- `src/renderer/src/lib/variables.js` — новый чистый модуль подстановки.
- `src/renderer/src/stores/environments.js` — новый store (список, активное окружение активного проекта).
- `src/renderer/src/components/Toolbar.vue` — живой селектор + кнопка-шестерёнка; `EnvironmentsDialog.vue` — новый диалог управления.
- `src/renderer/src/stores/tabs.js` — `sendActive` подставляет переменные в снимок перед IPC.
- `scripts/smoke.mjs` — тесты подстановки и CRUD окружений.
- Зависимости не добавляются.
