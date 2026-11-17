# Tasks

## 1. Хранилище и IPC

- [x] 1.1 `src/main/storage.js`: `locked: false` в записи при `createProject`; `setProjectLocked(id, locked)` (валидация: проект существует, boolean) возвращает обновлённую запись; guard в `deleteProject` — заблокированный проект отклоняется с ошибкой «Проект заблокирован» до записи индекса и `rm`; проверить в smoke: create → setLocked(true) → запись с `locked: true` на диске, `deleteProject` отклоняется и данные целы, setLocked(false) → удаление работает; persist после повторного bootstrap
- [x] 1.2 `src/main/ipc.js` + `src/preload/index.js`: канал `projects:setLocked {id, locked}` → обновлённая запись, `api.projects.setLocked`; проверить: `npm run dev` стартует, канал по префиксу `projects:*`

## 2. UI сайдбара

- [x] 2.1 `stores/projects.js`: action `setLocked(id, locked)` (обновляет запись в списке из ответа); `ProjectList.vue`: кнопка-замок 🔒/🔓 в actions (confirm через dialog в обе стороны), 🔒-индикатор у имени заблокированного, ✕ `:disabled` + `title="Проект заблокирован"`; стили индикатора; проверить в ручную: блокировка с подтверждением, индикатор, ✕ неактивна, разблокировка, отмена диалога ничего не меняет

## 3. Интеграция

- [x] 3.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + флаг/guard)
- [x] 3.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): создать проект → заблокировать (confirm) → индикатор и неактивная ✕ → попытка удалить из другой поверхности невозможна → перезапуск: блокировка на месте → разблокировать (confirm) → удалить с подтверждением — проект исчез

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — влит ADDED «Блокировка проекта» и MODIFIED «Удаление проекта» в `openspec/specs/projects-management/spec.md`.
