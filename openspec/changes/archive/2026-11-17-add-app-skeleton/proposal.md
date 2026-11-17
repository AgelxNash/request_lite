# Proposal

## Why

Проект создаётся с нуля: без каркаса нет ни окна, ни раскладки, ни хранилища — на чём строить последующие изменения (запросы, curl, окружения, импорт). Первое изменение фиксирует архитектурные границы плана (main/preload/renderer, IPC, JSON-хранилище) и сразу даёт работающие два сценария: CRUD проектов и переключение темы, чтобы все следующие change ложились на готовый фундамент.

## What Changes

- Создаётся скелет проекта с нуля: `package.json`, `electron.vite.config.mjs`, каталоги `src/main`, `src/preload`, `src/renderer` (Vue 3 + Vite + Pinia, чистый JS), тёмная тема по умолчанию.
- Окно Electron с меню (New Project, Open data folder) и раскладкой в стиле Postman: тулбар / сайдбар проектов / редактор запроса + область ответа. Все зоны присутствуют с пустыми состояниями; кнопка Send неактивна (логика запросов — в следующих изменениях).
- Настоящий фундамент IPC: `src/preload/index.js` (contextBridge → `window.api.*`), `src/main/ipc.js`, каналы `projects:*`, `settings:get`/`settings:set`, `data:openFolder`.
- `src/main/storage.js`: JSON-хранилище в `app.getPath('userData')/storage/` с атомарной записью (tmp + rename).
- Полноценный CRUD проектов через реальные JSON-файлы (`projects.json` + `projects/<id>.json`): создание, переименование, удаление, отображение в сайдбаре.
- Переключение тёмной/светлой темы: CSS-переменные + `data-theme` на `<html>`, стор `stores/ui.js`, кнопка в тулбаре, персист выбора в `settings.json` через IPC.
- `scripts/smoke.mjs` — смоук-тесты чистым Node (без Electron): CRUD хранилища; `scripts/echo-server.mjs` — echo-сервер на порту 4545 для будущих ручных e2e.
- Команды `npm run dev`, `npm run build`, `npm run dist` (electron-builder mac, подпись отключена).

## Capabilities

### New Capabilities

- `app-shell`: окно приложения, меню и раскладка интерфейса в стиле Postman (тулбар, сайдбар, редактор запроса, область ответа) с пустыми состояниями до появления логики запросов.
- `projects-management`: создание, переименование и удаление проектов с сохранением в JSON-файлы (индекс `projects.json`, один файл на проект `projects/<id>.json`) и отображением в сайдбаре.
- `theme-switching`: переключение тёмной/светлой темы интерфейса через CSS-переменные с сохранением выбора пользователя в `settings.json`.

### Modified Capabilities

(нет — первые capability проекта)

## Impact

- Создаётся вся кодовая база проекта (workspace пуст): конфигурация сборки, три слоя Electron (main / preload / renderer), Pinia-сторы (`projects`, `tabs`, `ui`), стили с CSS-переменными.
- Новые зависимости: `electron`, `electron-vite`, `vue`, `pinia`, `electron-builder` (dev). Других рантайм-зависимостей нет — JSON-подсветка и curl-логика появятся позже как собственный код.
- Файлы данных пользователя: `userData/storage/projects.json`, `userData/storage/projects/<id>.json`, `userData/storage/settings.json`.
- Внешние контракты: контур IPC расширяет префиксы из AGENTS.md каналом `settings:*` (настройки тоже хранятся в JSON — в духе проекта).
- Затрагивает AGENTS.md: после реализации уточнить в разделе «Хранение» наличие `settings.json` (сделать при archive/sync, не в рамках кода).
