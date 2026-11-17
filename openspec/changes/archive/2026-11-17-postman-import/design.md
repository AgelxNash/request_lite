# Design

## Context

Всё нужное для приёма импорта уже есть: `createProject`, атомарная запись файла проекта, окружения с `activeEnvId` (environment-variables), KV-модель полей запроса, паттерн «чистый модуль + smoke» (curl.js, variables.js). Меню и preload-проброс меню-каналов отработаны (import-curl).

## Goals / Non-Goals

**Goals:**
- Файл коллекции → готовый проект с запросами и активным окружением за одну операцию.

**Non-Goals:**
- Импорт отдельных окружений Postman, v1.x, скриптов/событий, файлов в formdata (литерал `@src`), graphql/file тел, повторный импорт с дедупликацией.

## Decisions

### D1. Парсер — чистый `lib/postman.js`
`parseCollection(text)` — JSON.parse + структурная валидация (объект, `info.name` — строка, `item` — массив; иначе ошибка «Не похоже на коллекцию Postman v2.x»). Рекурсивный обход `item[]`: item с `item[]` — папка (префикс накапливается « / »), item с `request` — запрос. Результат: `{name, requests: [{id, name, method, url, params, headers, body, auth, sslVerify: true, locked: false}], variables: [{id, key, value, enabled}]}` — форма записей хранилища. Записи уже в форме снимков вкладки — переиспользование формы данных без конвертации на границе.

### D2. Конвертация полей
URL: строка — как есть; объект — `raw` в URL, `query[]` → params (`disabled` → enabled: false). Headers: `header[]` → rows (disabled → снятая галочка), id генерируются. Body: `mode: raw` → json при `options.raw.lang === 'json'` (иначе text), `urlencoded` → пары в `body.urlencoded`, `formdata` → `body.form` (item.value.type === 'file' → значение `@${src}`, src может быть массивом — берём первый), `file`/`graphql` → none. Auth: `auth.type` bearer/basic/apikey → модель приложения (bearer: `auth.bearer[].value` токена; basic: username/password из пар key/value; apikey: key/value + `in` → placement); запрос без `auth` → collection-level `auth` (наследование — одно присваивание по умолчанию).

### D3. Bulk-импорт одной атомарной записью
`storage.importCollection({name, requests, variables})` — `createProject`-подобная логика: запись индекса + файл проекта `{requests, environments: [environment], activeEnvId: envId}` — **одна** `writeJsonAtomic` для файла проекта (в отличие от N×`saveRequest`). Возвращает полный проект. Канал `projects:importCollection` → renderer: projects store вставляет проект и делает активным, environments store перезагружает активный проект. Никакого N-кратного IPC-сохранения.

### D4. File picker и чтение в main
Канал `postman:pickAndRead` → `dialog.showOpenDialog` (filter `[{name: 'Postman Collection', extensions: ['json']}]`) + `readFile` в main (возврат `{ok, content}` / `{ok: false, cancelled}`). Renderer парсит и решает: успех → bulk-импорт, ошибка → диалог с сообщением. Парсинг в renderer (а не в main) — lib живёт рядом с остальными чистыми модулями и тестируется одним способом.

### D5. UI-фидбек — существующий AppDialog
Меню «Импорт коллекции Postman» (без accelerator) → `postman:pickAndRead` → при отмене — ничего; при ошибке парсинга → `AppDialog` с сообщением ошибки (alert-режим: title+message, одна кнопка ОК — у AppDialog нет alert-режима: используем confirm с одной подписью «Понятно»... минимально — добавить `alert`-мод в AppDialog (message + одна кнопка) — маленькое расширение). Успех — без диалога: проект появился в сайдбаре и активен (визуального подтверждения достаточно, как в Postman).

### D6. v2.0 и v2.1
Обе схемы поддерживаются одним парсером: отличия (уровень `variable.disabled`, форма `formdata`/`urlencoded` item'ов, `options.raw.lang`) нормализуются defensive-кодом (`.filter(Boolean)`, `(item.value && item.value.value) ?? item.value ?? ''`).

## Risks / Trade-offs

- [Крупные коллекции (сотни запросов)] → парсинг в renderer мгновенный, bulk-запись одна — узкое место отсутствует; лимит тела IPC ~сотни МБ — не достигается.
- [Кривые коллекции (нет name у item, битые query)] → дефолты: имя из URL-сегмента, пропуск пустых пар — tolerant-парсинг как в curl.
- [Коллизия имён проектов] → createProject разрешает дубликаты (задокументировано в projects-management) — повторный импорт создаёт второй проект.
- [AppDialog alert-мод] → минимальное расширение существующего компонента.

## Migration Plan

Не требуется.

## Open Questions

Нет.
