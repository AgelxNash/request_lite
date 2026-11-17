# Design

## Context

Вкладка (`stores/tabs.js`) несёт полную модель запроса; `toSnapshot(tab)` уже сериализует ровно те поля, которые нужно хранить (name/method/url/params/headers/body/auth/sslVerify — без runtime). Проекты: `activeProjectId` в store, `AppDialog.prompt/confirm` готовы, `projects/<id>.json` содержит `requests: []` с каркаса. Отправка не меняется — вкладка из проекта работает через существующий `sendActive`.

## Goals / Non-Goals

**Goals:**
- Круг «создал → сохранил → закрыл → открыл из проекта → отправил → обновил» и удаление с отвязкой вкладок.

**Non-Goals:**
- Папки/дерево, окружения, импорт/экспорт, автосохранение, сортировка и переупорядочивание, конфликт-резолюция при параллельных правках.

## Decisions

### D1. `savedRequestId` и `dirty` на вкладке
Вкладка получает `savedRequestId: null` и `dirty: false`. `dirty = true` ставится в `updateActive`/`updateActiveBody`/`updateActiveAuth`; `openSaved` и `saveActive` сбрасывают. Имя поля — не `requestId`: оно занято отменой отправки.

### D2. Хранение — реюз `toSnapshot`
Сохраняем `toSnapshot(tab)` как есть (без runtime-полей) + `id` запроса. Альтернатива — отдельный сериализатор — отклонена: дублирование формы данных, риск расхождения.

### D3. Хранилище: upsert + delete + list
`saveRequest(projectId, request)` — вставка или замена по `request.id` (upsert), имя непустое; `deleteRequest(projectId, requestId)`; `listRequests(projectId)` — чтение `requests[]` из `getProject`. Файл проекта перезаписывается атомарно целиком.

### D4. EPERM-retry в `writeJsonAtomic`
`rename` может упасть с `EPERM` на Windows (антивирус/индексатор держат файл). Retry до 3 попыток с паузой 50 мс; другие коды — без retry. Тестом не покрывается (fs замокан быть не может без DI) — код-ревью и ручной прогон на Windows при случае.

### D5. IPC `requests:*` и мост
`requests:list(projectId)`, `requests:save(projectId, request)`, `requests:delete(projectId, requestId)`; в preload — `api.requests.{list, save, delete}`. Канал возвращает обновлённый `requests[]` проекта, чтобы renderer держал один источник правды.

### D6. Имя при первом сохранении — из URL
Дефолт имени: последний непустой сегмент path (или hostname, если path пуст) — `https://example.com/api/users` → `users`, `https://example.com` → `example.com`. Пустой результат → `Untitled Request`. Диалог (`AppDialog.prompt`) с этим предзаполнением; пустое имя в диалоге → отказ от сохранения.

### D7. Store запросов и сайдбар
Новый `stores/requests.js`: `items`, `load(projectId)`, `save`, `remove`; Sidebar рендерит `RequestList.vue` под списком проектов для активного проекта. Клик — событие `open` → `tabs.openSaved(request)`.

### D8. Кнопка Save и меню
Кнопка Save слева от Send (`disabled` при отправке или отсутствии активного проекта, title с подсказкой). Пункт меню «Save Request» (`CmdOrCtrl+S`) → `menu:save-request` → `tabs.saveActive()`.

### D9. Удаление и отвязка
Confirm через `AppDialog.confirm` (как у проектов). После удаления `tabs` отвязывает вкладки с этим `savedRequestId` (`savedRequestId = null`, `dirty = false`). Повторный Save из такой вкладки создаёт новый запрос.

## Risks / Trade-offs

- [Проект удалён, пока вкладка связана с его запросом] → при удалении проекта вкладки не отвязываются (нет списка id); Save из такой вкладки уйдёт в новый активный проект как новое сохранение — приемлемо, отмечено как известное поведение.
- [Один запрос в двух вкладках] → независимые снимки, последний Save выигрывает; конфликт-резолюция вне scope.
- [EPERM-retry маскирует реальную проблему] → только код EPERM, максимум 3 попытки, затем ошибка наружу (CORRUPT_STORAGE-семантика не затрагивается).

## Migration Plan

Не требуется: `requests[]` уже существует в файлах проектов, формат записи новый, но массив пуст.

## Open Questions

Нет.
