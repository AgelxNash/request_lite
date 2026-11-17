# Tasks

## 1. Подстановка (чистый модуль)

- [x] 1.1 Создать `src/renderer/src/lib/variables.js`: `buildVars(variables)` (только `enabled` и непустой ключ) и `applyEnvironment(snapshot, vars)` (url, params key+value, headers key+value, body.json/text, значения urlencoded/form-data; без рекурсии); проверить в smoke: подстановка во всех полях, многократные вхождения, неразрешённый плейсхолдер литерально, выключенная переменная игнорируется, пустой словарь = литеральный снимок

## 2. Хранилище и IPC

- [x] 2.1 `src/main/storage.js`: `saveEnvironment` (upsert по id, имя непустое), `deleteEnvironment` (с обнулением `activeEnvId` удалённого активного), `setActiveEnvironment` (id | null), `listEnvironments` (возвращает `{environments, activeEnvId}`); проверить в smoke: upsert с сохранением позиции, delete + обнуление активного, setActive персистентен между bootstrap
- [x] 2.2 `src/main/ipc.js` + `src/preload/index.js`: каналы `environments:list|save|delete|setActive` и `api.environments.*`; проверить: `npm run dev` стартует без ошибок, каналы по префиксу `environments:*`

## 3. Store и UI

- [x] 3.1 Создать `stores/environments.js` (`items`, `activeId`, `load(projectId)`, `setActive`, `save`, `remove`) с реакцией на смену активного проекта; проверить в ручную: переключение проекта меняет список и активный выбор
- [x] 3.2 `Toolbar.vue`: живой селектор (окружения активного проекта + «No Environment») и кнопка-шестерёнка → диалог; проверить в ручную: выбор сохраняется между перезапусками
- [x] 3.3 Создать `components/EnvironmentsDialog.vue`: список окружений (создать/удалить с confirm) + редактор (имя, `KeyValueTable` переменных, кнопка Сохранить → upsert); стили; проверить в ручную: create → редактирование → save → reopen, удаление активного обнуляет селектор

## 4. Отправка с подстановкой

- [x] 4.1 `stores/tabs.js` → `sendActive()`: собирает словарь активного окружения (`environments` store) и подставляет через `applyEnvironment` в снимок перед IPC; проверить в ручную: `{{baseUrl}}` уходит разрешённым при активном окружении и литерально при «No Environment»

## 5. Интеграция

- [x] 5.1 Полный smoke: `node scripts/smoke.mjs` зелёный (старые тесты + подстановка + CRUD окружений)
- [x] 5.2 Ручной e2e (`node scripts/echo-server.mjs` + `npm run dev`): создать окружение `Dev` (`baseUrl=http://localhost:4545`, `token=t-e2e`) → запрос `{{baseUrl}}/echo` с header `Authorization: Bearer {{token}}` и param `page={{page}}` (`page=2` в окружении) → Send: echo показывает подставленные url/headers/query; переключить на «No Environment» → Send: литеральные `{{...}}`; перезапуск: выбор окружения восстановлен

## Workflow follow-up

- После приёмки: sync-specs/archive change (openspec-archive-change) — создаст `environment-variables` и обновит «Окно и раскладка в стиле Postman» в `app-shell`.
