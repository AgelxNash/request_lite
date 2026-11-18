# AGENTS.md — Request Lite

Локальный аналог Postman: Electron + Vue 3 + Vite (electron-vite) + Pinia. Чистый JavaScript (без TypeScript). Тёмная тема в стиле Postman. Проект создаётся с нуля, хранение — JSON-файлы.

## Язык работы
Весь код, комментарии, UI-тексты и ответы — на русском (идентификаторы/имена файлов — на английском по конвенции JS).

## Workflow: OpenSpec (spec-driven)
Проект ведётся через OpenSpec (`openspec/config.yaml`, schema `spec-driven`). Скиллы лежат в `.agents/skills/` (openspec-propose, openspec-apply-change, openspec-update-change, openspec-archive-change, openspec-sync-specs, openspec-explore).

- Планирование и реализация — **раздельные этапы**: сначала propose (артефакты, код не трогаем), затем явный запрос на apply.
- Артефакты изменения: `openspec/changes/<name>/` — `proposal.md` (что и зачем), `specs/<capability>/spec.md` (дельта требований), `design.md` (как), `tasks.md` (шаги).
- Основные спеки — в `openspec/specs/<capability>/spec.md`; после завершения изменения — sync-specs или archive (в `openspec/changes/archive/`).
- Корень `openspec/` не создавать вручную и не давать создавать CLI-командам как побочный эффект; `openspec list --json` показывает, инициализирован ли root.

## Команды
- `npm run dev` — electron-vite dev (hot reload)
- `npm run build` — сборка
- `npm run dist` — electron-builder mac (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `identity: null` — подпись отключена)
- `node scripts/smoke.mjs` — смоук-тесты (чистый Node, без Electron, 94 проверки): парсер/генератор curl, CRUD/блокировка/закрепление/перемещение хранилища, переменные, импорт Postman-коллекции
- `node scripts/echo-server.mjs` — локальный echo-сервер на порту 4545 для ручного e2e
- Требование среды: Node ≥ 18

## Архитектура (границы слоёв — не нарушать)
```
src/main/    — main-процесс: index.js (окно/меню), http.js (выполнение запросов),
               storage.js (JSON-хранилище), ipc.js (обработчики каналов)
src/preload/ — contextBridge → window.api.* (единственный мост renderer↔main)
src/renderer/src/
  stores/    — Pinia: projects.js, requests.js, tabs.js, environments.js, ui.js
  lib/       — curl.js (парсер+генератор), postman.js (импорт коллекций),
               variables.js ({{var}}), format.js, defaults.js, request-name.js
  components/— Vue-компоненты (Sidebar, ProjectList, RequestList, RequestTabs,
               RequestEditor, ResponseView, ContextMenu, диалоги и т.д.)
```

Ключевые правила:
- **HTTP-запросы выполняются ТОЛЬКО в main-процессе** (`src/main/http.js` через Node `fetch`, AbortController для Cancel, таймаут 30с, лимит тела ответа 10МБ). Никаких fetch из renderer — так снимается CORS.
- Renderer не имеет доступа к Node (`nodeIntegration: false`); всё общение через preload `window.api.*`.
- IPC-каналы строго по префиксам: `projects:*`, `requests:*`, `environments:*`, `settings:*`, `http:request`/`http:cancel`, `data:openFolder`, `postman:*`, `shell:*`, `clipboard:*`, `app:*`; push-каналы из меню — `menu:*`.
- Модель списков единообразна (вкладки, запросы, проекты): перетаскивание — pointer-события с порогом 4px (клик ≠ drag), слушатели move/up/cancel на `window` (setPointerCapture снимается неявно при DOM-перемещении узла — не использовать); закреплённые (pin) — префикс списка с жёсткой границей зон, drag внутри зоны разрешён. Инвариант «закреплённые первыми» для сайдбара живёт в `storage.js` (порядок — данные на диске), для вкладок — в `tabs.js` (runtime-состояние).
- Запись JSON — атомарная (tmp + rename) в `storage.js`.
- Зависимости в renderer не тянуть без необходимости: JSON-подсветка — своя лёгкая реализация (`format.js`), без библиотек.

## Хранение (`app.getPath('userData')/storage/`)
- `projects.json` — индекс проектов `{id, name, createdAt, updatedAt, locked, pinned}`; порядок массива = порядок в сайдбаре (закреплённые — префикс)
- `projects/<id>.json` — один файл на проект: `requests[]` (порядок массива = порядок в сайдбаре), `environments[]`, `activeEnvId`
- `settings.json` — настройки приложения `{theme: 'dark' | 'light', ...}` (читается синхронно в preload при старте ради темы без вспышки)
- Request (запись на диске): `{id, name, method, url, params[], headers[], body{type, json|form|text}, auth{type: none|bearer|basic|apikey}, sslVerify, locked, pinned}` — `locked`/`pinned` — метаданные записи (в снимке вкладки их нет): upsert не сбрасывает, новые/импорт создаются с `false`
- Environment: `{id, name, variables:[{key, value, enabled}]}`

## Предметные правила
- Переменные окружения `{{baseUrl}}` подставляются в URL/params/headers/body только в момент отправки; неразрешённые остаются как есть.
- Auth (Bearer/Basic/API-key) конвертируется в заголовки/query на момент отправки, а не хранится как headers.
- curl-парсер — собственный (`lib/curl.js`): shell-токенизация + флаги `-X, -H, -d/--data-raw/--data-binary/--form, -u, -b, --json, -G, --url`; при `-d` метод по умолчанию POST. Генератор curl — с корректным экранированием кавычек.
- Импорт Postman (v2.x JSON): коллекция → новый проект; папки → префикс `Folder / Request`; raw/urlencoded/formdata (без файлов); `collection.variable` → окружение с именем коллекции.
- Блокировка (🔒) защищает содержимое и удаление, не позицию: заблокированный не перетаскивается, но сдвигается при drag других. Закрепление (📌) фиксирует позицию: закреплённый не выносится из верхней зоны. Флаги независимы.

## Верификация перед сдачей
1. `node scripts/smoke.mjs` должен проходить.
2. `npm run dev` — окно запускается.
3. Ручной e2e при изменениях UI/IPC: echo-сервер → создать проект/окружение → GET/POST → save → переоткрыть (persist) → drag/закрепление затронутых списков → перезапуск (persist порядка и флагов) → curl-импорт/экспорт → импорт Postman-коллекции.
