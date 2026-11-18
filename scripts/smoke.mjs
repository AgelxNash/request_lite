// Смоук-тесты: чистый Node, без Electron — хранилище, сборка/выполнение запросов, формат JSON.
// Запуск: node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const storage = await import('../src/main/storage.js')
const http = await import('../src/main/http.js')
const format = await import('../src/renderer/src/lib/format.js')
const defaults = await import('../src/renderer/src/lib/defaults.js')
const requestName = await import('../src/renderer/src/lib/request-name.js')
const variables = await import('../src/renderer/src/lib/variables.js')
const curl = await import('../src/renderer/src/lib/curl.js')
const postman = await import('../src/renderer/src/lib/postman.js')

let passed = 0

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`  ok — ${name}`)
    })
}

const root = await mkdtemp(join(tmpdir(), 'postman-lite-smoke-'))

try {
  // --- Проекты: create → list ---
  await storage.initStorage(root)
  await storage.bootstrap()

  await check('createProject создаёт проект и возвращает структуру', async () => {
    const project = await storage.createProject('Alpha')
    assert.equal(project.name, 'Alpha')
    assert.ok(project.id)
    assert.ok(project.createdAt)
    assert.ok(project.updatedAt)
  })

  await check('второй проект с тем же именем существует как отдельная запись', async () => {
    await storage.createProject('Alpha') // то же имя — отдельный проект
    const projects = await storage.listProjects()
    assert.equal(projects.length, 2)
    assert.notEqual(projects[0].id, projects[1].id)
  })

  await check('createProject отклоняет пустое имя', async () => {
    await assert.rejects(() => storage.createProject('   '), /пустым/)
  })

  // --- Структура файлов ---
  await check('на диске: projects.json + projects/<id>.json с дефолтным содержимым', async () => {
    const index = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
    assert.equal(index.length, 2)
    const projectFile = JSON.parse(await readFile(join(root, 'projects', `${index[0].id}.json`), 'utf8'))
    assert.deepEqual(projectFile, { requests: [], environments: [], activeEnvId: null })
  })

  await check('после записи не остаётся .tmp файлов (атомарность)', async () => {
    const files = await readdir(root)
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0)
  })

  // --- rename ---
  await check('renameProject меняет имя в индексе, данные проекта сохраняются', async () => {
    const [first] = await storage.listProjects()
    const updated = await storage.renameProject(first.id, 'Alpha-2')
    assert.equal(updated.name, 'Alpha-2')
    const index = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
    assert.equal(index.find((p) => p.id === first.id).name, 'Alpha-2')
    const projectFile = JSON.parse(await readFile(join(root, 'projects', `${first.id}.json`), 'utf8'))
    assert.deepEqual(projectFile, { requests: [], environments: [], activeEnvId: null })
  })

  await check('renameProject неизвестного id отклоняется', async () => {
    await assert.rejects(() => storage.renameProject('no-such-id', 'X'), /не найден/)
  })

  // --- Персистентность: переинициализация на той же папке ---
  await check('после переинициализации проекты читаются с диска (persist)', async () => {
    const storage2 = await import('../src/main/storage.js')
    const fresh = join(root) // та же папка; имитируем новый запуск: новая инициализация кэша
    storage2.initStorage(fresh)
    await storage2.bootstrap()
    const projects = await storage2.listProjects()
    assert.equal(projects.length, 2)
    assert.ok(projects.some((p) => p.name === 'Alpha-2'))
  })

  // --- delete ---
  await check('deleteProject убирает запись из индекса и файл проекта', async () => {
    const projects = await storage.listProjects()
    const victim = projects[1]
    await storage.deleteProject(victim.id)
    const rest = await storage.listProjects()
    assert.equal(rest.length, 1)
    await assert.rejects(() => readFile(join(root, 'projects', `${victim.id}.json`), 'utf8'), /ENOENT/)
  })

  await check('deleteProject неизвестного id отклоняется', async () => {
    await assert.rejects(() => storage.deleteProject('no-such-id'), /не найден/)
  })

  // --- Блокировка проекта: setLocked + guard удаления ---
  const lockProject = await storage.createProject('Защищённый')

  await check('createProject создаёт запись с locked: false', async () => {
    const projects = await storage.listProjects()
    const created = projects.find((p) => p.id === lockProject.id)
    assert.equal(created.locked, false)
  })

  await check('setProjectLocked пишет флаг на диск и валидирует аргументы', async () => {
    const updated = await storage.setProjectLocked(lockProject.id, true)
    assert.equal(updated.locked, true)
    const onDisk = await storage.getProject(lockProject.id)
    // флаг в индексе; файл проекта не обязан его содержать — проверяем индекс
    const projects = await storage.listProjects()
    assert.equal(projects.find((p) => p.id === lockProject.id).locked, true)
    await assert.rejects(() => storage.setProjectLocked(lockProject.id, 'yes'), /boolean/)
    await assert.rejects(() => storage.setProjectLocked('no-such-id', true), /не найден/)
    void onDisk
  })

  await check('deleteProject отклоняет заблокированный проект, данные целы', async () => {
    await assert.rejects(() => storage.deleteProject(lockProject.id), /заблокирован/)
    const projects = await storage.listProjects()
    assert.ok(projects.some((p) => p.id === lockProject.id), 'запись в индексе на месте')
    const data = await storage.getProject(lockProject.id)
    assert.ok(data, 'файл проекта на месте')
  })

  await check('после разблокировки удаление работает, persist блокировки между bootstrap', async () => {
    // persist: перечитываем через новый bootstrap (кэш настроек не участвует, но проверим чтение с диска)
    const projects = await storage.listProjects()
    assert.equal(projects.find((p) => p.id === lockProject.id).locked, true)
    await storage.setProjectLocked(lockProject.id, false)
    await storage.deleteProject(lockProject.id)
    const after = await storage.listProjects()
    assert.ok(!after.some((p) => p.id === lockProject.id), 'проект удалён после разблокировки')
  })

  // --- Перемещение проектов: reorderProjects (порядок массива индекса) ---
  const rA = await storage.createProject('Reorder-A')
  const rB = await storage.createProject('Reorder-B')
  const rC = await storage.createProject('Reorder-C')
  // Подпоследовательность из трёх тестовых проектов: остальные тесты могут
  // добавлять в индекс свои записи — порядок внутри тройки не зависит от них.
  const rIds = [rA.id, rB.id, rC.id]
  const rNames = async () =>
    (await storage.listProjects())
      .filter((p) => rIds.includes(p.id))
      .map((p) => p.name)

  await check('reorderProjects меняет порядок индекса, замок записи не тронут', async () => {
    await storage.setProjectLocked(rB.id, true) // замок соседа не мешает
    await storage.reorderProjects(rC.id, 0)
    assert.deepEqual(await rNames(), ['Reorder-C', 'Reorder-A', 'Reorder-B'])
    // Персистентность: порядок и флаг замка перечитываются с диска.
    const reread = await storage.listProjects()
    assert.deepEqual(
      reread.filter((p) => rIds.includes(p.id)).map((p) => p.name),
      ['Reorder-C', 'Reorder-A', 'Reorder-B']
    )
    assert.equal(reread.find((p) => p.id === rB.id).locked, true)
  })

  await check('reorderProjects двигает и сам заблокированный проект (содержимое неизменно)', async () => {
    const list = await storage.reorderProjects(rB.id, 1)
    assert.equal(list.find((p) => p.id === rB.id).locked, true)
    assert.deepEqual(await rNames(), ['Reorder-C', 'Reorder-B', 'Reorder-A'])
    await storage.setProjectLocked(rB.id, false)
  })

  await check('reorderProjects отклоняет невалидные аргументы', async () => {
    await assert.rejects(() => storage.reorderProjects('', 0), /должен быть id/)
    await assert.rejects(() => storage.reorderProjects(rB.id, -1), /toIndex/)
    await assert.rejects(() => storage.reorderProjects(rB.id, 1.5), /toIndex/)
    await assert.rejects(() => storage.reorderProjects('no-such-id', 0), /не найден/)
    // toIndex больше длины зажимается, а не отклоняется.
    await storage.reorderProjects(rB.id, 99)
    assert.deepEqual(await rNames(), ['Reorder-C', 'Reorder-A', 'Reorder-B'])
    await storage.reorderProjects(rB.id, 1)
  })

  await check('после reorder-тестов тестовые проекты удаляются', async () => {
    await storage.deleteProject(rA.id)
    await storage.deleteProject(rB.id)
    await storage.deleteProject(rC.id)
    const after = await storage.listProjects()
    assert.ok(!after.some((p) => rIds.includes(p.id)), 'тройка удалена из индекса')
  })

  // --- Закрепление проектов: setProjectPinned (верхняя зона индекса) ---
  const pA = await storage.createProject('Pin-A')
  const pB = await storage.createProject('Pin-B')
  const pC = await storage.createProject('Pin-C')
  let pD // создаётся в тесте «новые проекты не закреплены»
  const pIds = [pA.id, pB.id, pC.id]
  const pNames = async () =>
    (await storage.listProjects())
      .filter((p) => pIds.includes(p.id))
      .map((p) => p.name)

  await check('setProjectPinned закрепляет в верхнюю зону и пишет на диск', async () => {
    await storage.setProjectPinned(pB.id, true)
    let list = await storage.listProjects()
    assert.deepEqual(await pNames(), ['Pin-B', 'Pin-A', 'Pin-C'])
    assert.equal(list.find((p) => p.id === pB.id).pinned, true)
    // Второй закреплённый встаёт после первого (последним среди закреплённых).
    await storage.setProjectPinned(pC.id, true)
    list = await storage.listProjects()
    assert.deepEqual(await pNames(), ['Pin-B', 'Pin-C', 'Pin-A'])
    assert.equal(list.find((p) => p.id === pC.id).pinned, true)
  })

  await check('renameProject не сбрасывает pin (метаданные записи)', async () => {
    await storage.renameProject(pB.id, 'Pin-B2')
    const list = await storage.listProjects()
    const renamed = list.find((p) => p.id === pB.id)
    assert.equal(renamed.name, 'Pin-B2')
    assert.equal(renamed.pinned, true)
  })

  await check('reorderProjects зажимает позицию в зону pin', async () => {
    // Закреплённый pC не выходит из зоны: попытка ниже границы — no-op для тройки.
    await storage.reorderProjects(pC.id, 99)
    assert.deepEqual(await pNames(), ['Pin-B2', 'Pin-C', 'Pin-A'])
    // Обычный pA не входит в зону: попытка наверх — no-op для тройки.
    await storage.reorderProjects(pA.id, 0)
    assert.deepEqual(await pNames(), ['Pin-B2', 'Pin-C', 'Pin-A'])
  })

  await check('pin и lock независимы, новые проекты не закреплены', async () => {
    await storage.setProjectLocked(pB.id, true)
    let list = await storage.listProjects()
    assert.equal(list.find((p) => p.id === pB.id).locked, true)
    assert.equal(list.find((p) => p.id === pB.id).pinned, true)
    pD = await storage.createProject('Pin-D')
    list = await storage.listProjects()
    assert.equal(list.find((p) => p.id === pD.id).pinned, false)
    await storage.setProjectPinned(pB.id, false)
    await storage.setProjectLocked(pB.id, false)
  })

  await check('setProjectPinned валидирует аргументы', async () => {
    await assert.rejects(() => storage.setProjectPinned(pB.id, 'yes'), /boolean/)
    await assert.rejects(() => storage.setProjectPinned('no-such-id', true), /не найден/)
  })

  await check('после pin-тестов тестовые проекты удаляются', async () => {
    for (const id of [...pIds, pD.id]) await storage.deleteProject(id)
    const after = await storage.listProjects()
    assert.ok(!after.some((p) => [...pIds, pD.id].includes(p.id)), 'четвёрка удалена из индекса')
  })

  // --- Запросы проекта: save/list/delete ---
  const requestsProject = await storage.createProject('Хранилище запросов')
  const fullRequest = {
    id: 'req-1',
    name: 'Users',
    method: 'POST',
    url: 'https://api.example.com/users',
    params: [{ id: 'p1', key: 'page', value: '2', enabled: true }],
    headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
    body: { type: 'json', json: '{"limit":5}' },
    auth: { type: 'bearer', token: 't-123' },
    sslVerify: false
  }

  await check('saveRequest добавляет запрос в requests[] и пишет на диск', async () => {
    const list = await storage.saveRequest(requestsProject.id, fullRequest)
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'Users')
    const onDisk = await storage.getProject(requestsProject.id)
    assert.equal(onDisk.requests.length, 1)
    assert.equal(onDisk.requests[0].body.json, '{"limit":5}')
    assert.equal(onDisk.requests[0].sslVerify, false)
  })

  await check('saveRequest с тем же id обновляет запись на её позиции (upsert)', async () => {
    await storage.saveRequest(requestsProject.id, { id: 'req-2', name: 'Token' })
    const list = await storage.saveRequest(requestsProject.id, {
      ...fullRequest,
      name: 'Users v2',
      url: 'https://api.example.com/v2'
    })
    assert.equal(list.length, 2)
    assert.equal(list[0].name, 'Users v2', 'позиция сохранена')
    assert.equal(list[0].url, 'https://api.example.com/v2')
    assert.equal(list[1].name, 'Token')
  })

  await check('saveRequest отклоняет пустое имя и запрос без id', async () => {
    await assert.rejects(() => storage.saveRequest(requestsProject.id, { id: 'req-3', name: '   ' }), /пустым/)
    await assert.rejects(() => storage.saveRequest(requestsProject.id, { name: 'NoId' }), /должен быть id/)
  })

  await check('deleteRequest убирает запрос, остальные остаются; неизвестный id отклоняется', async () => {
    const list = await storage.deleteRequest(requestsProject.id, 'req-1')
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'req-2')
    await assert.rejects(() => storage.deleteRequest(requestsProject.id, 'req-1'), /не найден/)
    const onDisk = await storage.getProject(requestsProject.id)
    assert.equal(onDisk.requests.length, 1)
  })

  // --- Блокировка запроса: setLocked + guard'ы ---
  const lockReqProject = await storage.createProject('Блокировка запросов')
  await storage.saveRequest(lockReqProject.id, { id: 'lr-1', name: 'Защищённый запрос' })
  await storage.saveRequest(lockReqProject.id, { id: 'lr-2', name: 'Обычный запрос' })

  await check('setRequestLocked пишет флаг на диск и валидирует аргументы', async () => {
    const list = await storage.setRequestLocked(lockReqProject.id, 'lr-1', true)
    assert.equal(list.find((r) => r.id === 'lr-1').locked, true)
    assert.equal(list.find((r) => r.id === 'lr-2').locked, false)
    await assert.rejects(() => storage.setRequestLocked(lockReqProject.id, 'lr-1', 'yes'), /boolean/)
    await assert.rejects(() => storage.setRequestLocked(lockReqProject.id, 'nope', true), /не найден/)
  })

  await check('saveRequest отклоняет обновление заблокированного, запись неизменна', async () => {
    await assert.rejects(
      () => storage.saveRequest(lockReqProject.id, { id: 'lr-1', name: 'Взломано', url: 'https://evil.test' }),
      /заблокирован/
    )
    const list = await storage.listRequests(lockReqProject.id)
    const locked = list.find((r) => r.id === 'lr-1')
    assert.equal(locked.name, 'Защищённый запрос', 'имя не перезаписано')
    assert.equal(locked.url ?? '', '', 'url не перезаписан')
    assert.equal(locked.locked, true)
  })

  await check('saveRequest создаёт новый запрос свободно, даже пока другой заблокирован', async () => {
    const list = await storage.saveRequest(lockReqProject.id, { id: 'lr-3', name: 'Новый свободный' })
    assert.equal(list.length, 3)
    assert.equal(list.find((r) => r.id === 'lr-3').locked, false)
  })

  await check('deleteRequest отклоняет заблокированный запрос', async () => {
    await assert.rejects(() => storage.deleteRequest(lockReqProject.id, 'lr-1'), /заблокирован/)
    const list = await storage.listRequests(lockReqProject.id)
    assert.equal(list.length, 3, 'запись осталась')
  })

  await check('после разблокировки save/delete работают', async () => {
    await storage.setRequestLocked(lockReqProject.id, 'lr-1', false)
    const list = await storage.saveRequest(lockReqProject.id, { id: 'lr-1', name: 'Изменено свободно' })
    assert.equal(list.find((r) => r.id === 'lr-1').name, 'Изменено свободно')
    const after = await storage.deleteRequest(lockReqProject.id, 'lr-1')
    assert.equal(after.length, 2)
  })

  // Текущее состояние lockReqProject: [lr-2, lr-3], оба разблокированы.

  await check('reorderRequests перемещает запрос и пишет порядок на диск', async () => {
    await storage.setRequestLocked(lockReqProject.id, 'lr-2', true) // замок соседа не мешает
    const list = await storage.reorderRequests(lockReqProject.id, 'lr-3', 0)
    assert.deepEqual(list.map((r) => r.id), ['lr-3', 'lr-2'])
    // Персистентность: повторное чтение с диска в том же порядке.
    const reread = await storage.listRequests(lockReqProject.id)
    assert.deepEqual(reread.map((r) => r.id), ['lr-3', 'lr-2'])
    assert.equal(reread.find((r) => r.id === 'lr-2').locked, true, 'содержимое и замок не тронуты')
  })

  await check('reorderRequests двигает и сам заблокированный запрос (содержимое неизменно)', async () => {
    const list = await storage.reorderRequests(lockReqProject.id, 'lr-2', 0)
    assert.deepEqual(list.map((r) => r.id), ['lr-2', 'lr-3'])
    assert.equal(list.find((r) => r.id === 'lr-2').locked, true)
    await storage.setRequestLocked(lockReqProject.id, 'lr-2', false)
  })

  await check('reorderRequests отклоняет невалидные аргументы', async () => {
    await assert.rejects(() => storage.reorderRequests(lockReqProject.id, '', 0), /должен быть id/)
    await assert.rejects(() => storage.reorderRequests(lockReqProject.id, 'lr-2', -1), /toIndex/)
    await assert.rejects(() => storage.reorderRequests(lockReqProject.id, 'lr-2', 1.5), /toIndex/)
    await assert.rejects(() => storage.reorderRequests(lockReqProject.id, 'nope', 0), /не найден/)
    // toIndex больше длины зажимается, а не отклоняется.
    const list = await storage.reorderRequests(lockReqProject.id, 'lr-2', 99)
    assert.deepEqual(list.map((r) => r.id), ['lr-3', 'lr-2'])
    await storage.reorderRequests(lockReqProject.id, 'lr-2', 0)
  })

  await check('reorderRequests работает при заблокированном проекте', async () => {
    await storage.setProjectLocked(lockReqProject.id, true)
    const list = await storage.reorderRequests(lockReqProject.id, 'lr-2', 1)
    assert.deepEqual(list.map((r) => r.id), ['lr-3', 'lr-2'])
    await storage.setProjectLocked(lockReqProject.id, false)
  })

  // Текущее состояние lockReqProject: [lr-3, lr-2], оба разблокированы и не закреплены.

  await check('setRequestPinned закрепляет в верхнюю зону и пишет на диск', async () => {
    await storage.setRequestPinned(lockReqProject.id, 'lr-2', true)
    const list = await storage.listRequests(lockReqProject.id)
    assert.deepEqual(list.map((r) => r.id), ['lr-2', 'lr-3'], 'закреплённый — префикс списка')
    assert.equal(list.find((r) => r.id === 'lr-2').pinned, true)
    // Второй закреплённый встаёт после первого (последним среди закреплённых).
    await storage.setRequestPinned(lockReqProject.id, 'lr-3', true)
    const both = await storage.listRequests(lockReqProject.id)
    assert.deepEqual(both.map((r) => r.id), ['lr-2', 'lr-3'])
    assert.equal(both.every((r) => r.pinned === true), true)
  })

  await check('saveRequest не сбрасывает pin при обновлении содержимого', async () => {
    const list = await storage.saveRequest(lockReqProject.id, { id: 'lr-2', name: 'Обновлено', url: 'https://upd.test' })
    const lr2 = list.find((r) => r.id === 'lr-2')
    assert.equal(lr2.pinned, true, 'pin сохранён при upsert')
    assert.equal(lr2.name, 'Обновлено')
    assert.deepEqual(list.map((r) => r.id), ['lr-2', 'lr-3'], 'позиция не изменилась')
  })

  await check('setRequestPinned открепляет перед первым обычным', async () => {
    await storage.setRequestPinned(lockReqProject.id, 'lr-2', false)
    const list = await storage.listRequests(lockReqProject.id)
    assert.deepEqual(list.map((r) => r.id), ['lr-3', 'lr-2'])
    assert.equal(list.find((r) => r.id === 'lr-3').pinned, true)
    assert.equal(list.find((r) => r.id === 'lr-2').pinned, false)
  })

  await check('reorderRequests зажимает позицию в зону pin', async () => {
    // Обычный lr-2 (индекс 1) не входит в зону закреплённых: попытка в 0 — no-op.
    const rest = await storage.reorderRequests(lockReqProject.id, 'lr-2', 0)
    assert.deepEqual(rest.map((r) => r.id), ['lr-3', 'lr-2'])
    // Закреплённый lr-3 (индекс 0) не выходит из зоны: попытка в 1 — no-op.
    const pinned = await storage.reorderRequests(lockReqProject.id, 'lr-3', 1)
    assert.deepEqual(pinned.map((r) => r.id), ['lr-3', 'lr-2'])
  })

  await check('saveRequest создаёт новый запрос незакреплённым, pin+lock независимы', async () => {
    await storage.saveRequest(lockReqProject.id, { id: 'lr-4', name: 'Новый' })
    let list = await storage.listRequests(lockReqProject.id)
    assert.equal(list.find((r) => r.id === 'lr-4').pinned, false)
    assert.deepEqual(list.map((r) => r.id), ['lr-3', 'lr-2', 'lr-4'])
    // Заблокированный запрос закрепляется как обычно — флаги независимы.
    await storage.setRequestLocked(lockReqProject.id, 'lr-3', true)
    await storage.setRequestPinned(lockReqProject.id, 'lr-3', true)
    list = await storage.listRequests(lockReqProject.id)
    assert.equal(list.find((r) => r.id === 'lr-3').locked, true)
    assert.equal(list.find((r) => r.id === 'lr-3').pinned, true)
    await storage.setRequestPinned(lockReqProject.id, 'lr-3', false)
    await storage.setRequestLocked(lockReqProject.id, 'lr-3', false)
    await storage.deleteRequest(lockReqProject.id, 'lr-4')
  })

  await check('setRequestPinned валидирует аргументы', async () => {
    await assert.rejects(() => storage.setRequestPinned(lockReqProject.id, 'lr-2', 'yes'), /boolean/)
    await assert.rejects(() => storage.setRequestPinned(lockReqProject.id, 'nope', true), /не найден/)
  })

  // --- Postman-импорт: fixture + parseCollection (lib/postman.js) ---

  // Fixture: вложенные папки, все body-режимы, disabled-поля, collection-level auth, переменные.
  const FIXTURE_COLLECTION = {
    info: { name: 'API Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: 't-coll' }] },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4545', disabled: false },
      { key: 'legacy', value: 'x', disabled: true }
    ],
    item: [
      {
        name: 'Auth',
        item: [
          {
            name: 'OAuth',
            item: [
              {
                name: 'Token',
                request: {
                  method: 'POST',
                  url: { raw: '{{baseUrl}}/token', query: [{ key: 'mode', value: 'client', disabled: true }] },
                  header: [{ key: 'Accept', value: 'application/json' }],
                  body: {
                    mode: 'urlencoded',
                    urlencoded: [
                      { key: 'grant_type', value: 'client_credentials' },
                      { key: 'skip', value: 'x', disabled: true }
                    ]
                  },
                  auth: { type: 'basic', basic: [{ key: 'username', value: 'user' }, { key: 'password', value: 'pass' }] }
                }
              }
            ]
          }
        ]
      },
      {
        name: 'JSON echo',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/echo',
          body: { mode: 'raw', options: { raw: { lang: 'json' } }, raw: '{"a":1}' }
        }
      },
      {
        name: 'Form',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/form',
          header: [{ key: 'X-Trace', value: '1', disabled: true }],
          body: {
            mode: 'formdata',
            formdata: [
              { key: 'note', value: 'hi' },
              { key: 'doc', type: 'file', src: '/tmp/doc.pdf' }
            ]
          }
        }
      },
      {
        name: 'Raw text',
        request: { method: 'POST', url: '{{baseUrl}}/text', body: { mode: 'raw', raw: 'просто текст' } }
      },
      {
        name: 'File body',
        request: { method: 'POST', url: '{{baseUrl}}/file', body: { mode: 'file', file: { src: '/x' } } }
      },
      { name: 'No body', request: { method: 'GET', url: '{{baseUrl}}/ping' } }
    ]
  }

  await check('parseCollection: типичная коллекция → проект/запросы/переменные', () => {
    const result = postman.parseCollection(JSON.stringify(FIXTURE_COLLECTION))
    assert.equal(result.name, 'API Demo')
    assert.equal(result.requests.length, 6)
    assert.equal(result.variables.length, 2)
    assert.equal(result.variables[0].key, 'baseUrl')
    assert.equal(result.variables[0].enabled, true)
    assert.equal(result.variables[1].enabled, false, 'выключенная переменная — снятая галочка')
  })

  await check('parseCollection: папки и вложенность → префиксы « / »', () => {
    const { requests } = postman.parseCollection(JSON.stringify(FIXTURE_COLLECTION))
    assert.deepEqual(
      requests.map((r) => r.name),
      ['Auth / OAuth / Token', 'JSON echo', 'Form', 'Raw text', 'File body', 'No body']
    )
  })

  await check('parseCollection: query/headers с disabled, urlencoded', () => {
    const { requests } = postman.parseCollection(JSON.stringify(FIXTURE_COLLECTION))
    const token = requests[0]
    assert.equal(token.method, 'POST')
    assert.equal(token.url, '{{baseUrl}}/token')
    assert.equal(token.params[0].key, 'mode')
    assert.equal(token.params[0].enabled, false, 'disabled query → снятая галочка')
    assert.equal(token.headers[0].key, 'Accept')
    assert.equal(token.headers[0].enabled, true)
    assert.equal(token.body.type, 'urlencoded')
    assert.equal(token.body.urlencoded[0].value, 'client_credentials')
    assert.equal(token.body.urlencoded[1].enabled, false)
    // собственная basic перекрывает collection-level bearer
    assert.equal(token.auth.type, 'basic')
    assert.equal(token.auth.username, 'user')
  })

  await check('parseCollection: тела raw+json / formdata+file / raw text / file → none', () => {
    const { requests } = postman.parseCollection(JSON.stringify(FIXTURE_COLLECTION))
    assert.equal(requests[1].body.type, 'json')
    assert.equal(requests[1].body.json, '{"a":1}')
    // наследование: запрос без своего auth получает bearer коллекции
    assert.equal(requests[1].auth.type, 'bearer')
    assert.equal(requests[1].auth.token, 't-coll')

    const form = requests[2]
    assert.equal(form.body.type, 'form-data')
    assert.equal(form.body.form[0].value, 'hi')
    assert.equal(form.body.form[1].value, '@/tmp/doc.pdf', 'файл-поле → литерал @src')
    assert.equal(form.headers[0].enabled, false, 'disabled header → снятая галочка')

    assert.equal(requests[3].body.type, 'text')
    assert.equal(requests[3].body.text, 'просто текст')

    assert.equal(requests[4].body.type, 'none', 'file-режим → none')
    assert.equal(requests[5].body.type, 'none')
    assert.equal(requests[5].method, 'GET')
  })

    await check('parseCollection: ошибки — не-JSON и не-коллекция', () => {
      assert.throws(() => postman.parseCollection('{ это не json'), /не является корректным JSON/)
      assert.throws(() => postman.parseCollection('{"name": "не коллекция"}'), /Не похоже на коллекцию/)
      assert.throws(() => postman.parseCollection('{"info": {"name": ""}, "item": []}'), /Не похоже на коллекцию/)
    })

    // --- Postman-импорт: bulk-хранилище (importCollection) ---

    await check('importCollection: проект + запросы + активное окружение одной записью', async () => {
      const parsed = postman.parseCollection(JSON.stringify(FIXTURE_COLLECTION))
      const project = await storage.importCollection({
        name: parsed.name,
        requests: parsed.requests,
        variables: parsed.variables
      })
      assert.equal(project.name, 'API Demo')
      const projects = await storage.listProjects()
      assert.ok(projects.some((p) => p.id === project.id), 'проект в индексе')
      const onDisk = await storage.getProject(project.id)
      assert.equal(onDisk.requests.length, 6)
      assert.equal(onDisk.environments.length, 1)
      assert.equal(onDisk.environments[0].name, 'API Demo')
      assert.equal(onDisk.environments[0].variables[0].key, 'baseUrl')
      assert.equal(onDisk.activeEnvId, onDisk.environments[0].id, 'окружение активно')
      assert.equal(onDisk.requests[0].name, 'Auth / OAuth / Token')
      await assert.rejects(() => storage.importCollection({ name: '   ' }), /пустым/)
    })

  // --- Окружения проекта: save/list/setActive/delete ---
  const envProject = await storage.createProject('Хранилище окружений')

  await check('saveEnvironment upsert: добавление, обновление на позиции, пустое имя', async () => {
    await storage.saveEnvironment(envProject.id, {
      id: 'env-1',
      name: 'Dev',
      variables: [{ id: 'v1', key: 'baseUrl', value: 'http://localhost', enabled: true }]
    })
    await storage.saveEnvironment(envProject.id, { id: 'env-2', name: 'Prod', variables: [] })
    const list = await storage.saveEnvironment(envProject.id, { id: 'env-1', name: 'Dev v2' })
    assert.equal(list.length, 2)
    assert.equal(list[0].name, 'Dev v2', 'позиция сохранена')
    assert.equal(list[1].name, 'Prod')
    await assert.rejects(() => storage.saveEnvironment(envProject.id, { id: 'env-3', name: '  ' }), /пустым/)
  })

  await check('setActiveEnvironment персистентен и отклоняет неизвестный id', async () => {
    const { activeEnvId } = await storage.setActiveEnvironment(envProject.id, 'env-1')
    assert.equal(activeEnvId, 'env-1')
    const onDisk = await storage.getProject(envProject.id)
    assert.equal(onDisk.activeEnvId, 'env-1')
    await assert.rejects(() => storage.setActiveEnvironment(envProject.id, 'nope'), /не найден/)
  })

  await check('deleteEnvironment обнуляет activeEnvId удалённого активного', async () => {
    const { activeEnvId, environments } = await storage.deleteEnvironment(envProject.id, 'env-1')
    assert.equal(environments.length, 1)
    assert.equal(activeEnvId, null)
    await assert.rejects(() => storage.deleteEnvironment(envProject.id, 'env-1'), /не найден/)
  })

  // --- Невалидный JSON не затирается ---
  await check('повреждённый projects.json вызывает CORRUPT_STORAGE и не перезаписывается', async () => {
    const garbage = '{ это не json'
    await writeFile(join(root, 'projects.json'), garbage, 'utf8')
    await assert.rejects(
      () => storage.listProjects(),
      (err) => err.code === 'CORRUPT_STORAGE'
    )
    const after = await readFile(join(root, 'projects.json'), 'utf8')
    assert.equal(after, garbage, 'файл не должен быть перезаписан')
  })

  // --- Настройки ---
  await check('getSettings по умолчанию возвращает тёмную тему', async () => {
    const settings = await storage.getSettings()
    assert.deepEqual(settings, { theme: 'dark' })
  })

  await check('setSettings сохраняет тему и другие ключи не теряются', async () => {
    await storage.setSettings({ theme: 'light' })
    await storage.setSettings({ futureSetting: 42 })
    const settings = await storage.getSettings()
    assert.deepEqual(settings, { theme: 'light', futureSetting: 42 })
    const onDisk = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))
    assert.equal(onDisk.theme, 'light')
  })

  await check('getSettingsSync (для preload) отдаёт актуальный кэш', () => {
    assert.deepEqual(storage.getSettingsSync(), { theme: 'light', futureSetting: 42 })
  })

  // --- HTTP: сборка запроса (buildRequest) ---

  await check('buildRequest мержит включённые params в query и сохраняет query из URL', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com/users?limit=10',
      params: [
        { id: '1', key: 'page', value: '2', enabled: true },
        { id: '2', key: 'limit', value: '99', enabled: true }
      ]
    })
    assert.equal(built.url, 'https://api.example.com/users?limit=10&page=2&limit=99')
    assert.equal(built.method, 'GET')
    assert.equal(built.body, undefined)
  })

  await check('buildRequest пропускает отключённые строки и строки с пустым ключом', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      params: [
        { id: '1', key: 'debug', value: '1', enabled: false },
        { id: '2', key: '', value: 'x', enabled: true },
        { id: '3', key: 'ok', value: 'yes', enabled: true }
      ],
      headers: [
        { id: '4', key: 'X-Trace', value: 'abc', enabled: false },
        { id: '5', key: 'X-Real', value: 'yes', enabled: true }
      ]
    })
    assert.ok(!built.url.includes('debug'), 'отключённый param не попадает в URL')
    assert.ok(built.url.endsWith('ok=yes'))
    assert.deepEqual(built.headers, [{ key: 'X-Real', value: 'yes' }])
  })

  await check('buildRequest отклоняет пустой и невалидный URL кодом INVALID_URL', () => {
    assert.throws(() => http.buildRequest({ method: 'GET', url: '' }), (err) => err.code === 'INVALID_URL')
    assert.throws(() => http.buildRequest({ method: 'GET', url: 'not a url' }), (err) => err.code === 'INVALID_URL')
    assert.throws(() => http.buildRequest({ method: 'GET', url: 'ftp://example.com' }), (err) => err.code === 'INVALID_URL')
  })

  await check('buildRequest: bearer → Authorization: Bearer <token>', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: 't-secret-123' }
    })
    assert.deepEqual(built.headers, [{ key: 'Authorization', value: 'Bearer t-secret-123' }])
  })

  await check('buildRequest: bearer с пустым токеном не добавляет заголовок', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: '' }
    })
    assert.deepEqual(built.headers, [])
  })

  await check('buildRequest: basic → Authorization: Basic <base64>, unicode через Buffer', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: 'user', password: 'pass' }
    })
    assert.equal(built.headers[0].value, 'Basic dXNlcjpwYXNz')
    const unicode = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: 'user', password: 'пароль' }
    })
    assert.equal(unicode.headers[0].value, 'Basic ' + Buffer.from('user:пароль', 'utf8').toString('base64'))
  })

  await check('buildRequest: apikey в заголовок и в query по placement', () => {
    const asHeader = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'apikey', key: 'X-Api-Key', value: 'k-42', placement: 'header' }
    })
    assert.deepEqual(asHeader.headers, [{ key: 'X-Api-Key', value: 'k-42' }])

    const asQuery = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'apikey', key: 'apiKey', value: 'k-42', placement: 'query' }
    })
    assert.equal(asQuery.url, 'https://api.example.com/?apiKey=k-42')
    assert.deepEqual(asQuery.headers, [])
  })

  await check('buildRequest: тело json с Content-Type application/json', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: { type: 'json', json: '{"name":"Ann"}' }
    })
    assert.equal(built.body, '{"name":"Ann"}')
    assert.deepEqual(built.headers, [{ key: 'Content-Type', value: 'application/json' }])
  })

  await check('buildRequest: пользовательский Content-Type не дублируется авто-заголовком', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      headers: [{ id: '1', key: 'content-type', value: 'application/vnd.api+json', enabled: true }],
      body: { type: 'json', json: '{}' }
    })
    assert.deepEqual(built.headers, [{ key: 'content-type', value: 'application/vnd.api+json' }])
  })

  await check('buildRequest: тело urlencoded из таблицы с экранированием', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com/token',
      body: {
        type: 'urlencoded',
        urlencoded: [
          { id: '1', key: 'grant_type', value: 'client_credentials', enabled: true },
          { id: '2', key: 'client_id', value: 'abc', enabled: true },
          { id: '3', key: 'note', value: 'a b&c', enabled: true }
        ]
      }
    })
    assert.equal(built.body, 'grant_type=client_credentials&client_id=abc&note=a%20b%26c')
    assert.equal(built.headers[0].value, 'application/x-www-form-urlencoded')
  })

  await check('buildRequest: тело text без обработки и none без тела', () => {
    const text = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: { type: 'text', text: 'просто текст' }
    })
    assert.equal(text.body, 'просто текст')
    assert.equal(text.headers[0].value, 'text/plain')

    const none = http.buildRequest({ method: 'GET', url: 'https://api.example.com', body: { type: 'none' } })
    assert.equal(none.body, undefined)
    assert.deepEqual(none.headers, [])
  })

  await check('buildRequest: form-data собирается как multipart с границей', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: {
        type: 'form-data',
        form: [
          { id: '1', key: 'field1', value: 'value1', enabled: true },
          { id: '2', key: '', value: 'skip', enabled: true },
          { id: '3', key: 'field2', value: 'value2', enabled: true }
        ]
      }
    })
    const ct = built.headers.find((h) => h.key === 'Content-Type')
    assert.ok(ct.value.startsWith('multipart/form-data; boundary=----postmanlite'), 'boundary в Content-Type')
    const boundary = ct.value.split('boundary=')[1]
    assert.ok(built.body.startsWith(`--${boundary}\r\n`))
    assert.ok(built.body.includes('Content-Disposition: form-data; name="field1"\r\n\r\nvalue1\r\n'))
    assert.ok(built.body.includes('name="field2"'))
    assert.ok(!built.body.includes('skip'), 'строка с пустым ключом не попадает в multipart')
    assert.ok(built.body.endsWith(`--${boundary}--\r\n`))
  })

  // --- HTTP: выполнение (sendRequest) на локальном сервере ---

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 500)
        return
      }
      if (req.url === '/hang') return // не отвечает: таймаут и отмена
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('x'.repeat(5000))
        return
      }
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'X-Served-By': 'smoke' })
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const closeServer = async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  try {
    await check('sendRequest выполняет GET с params, auth и заголовками, ответ содержит статус/время/тело', async () => {
      const response = await http.sendRequest(
        {
          method: 'GET',
          url: `${base}/users`,
          params: [{ id: '1', key: 'page', value: '2', enabled: true }],
          headers: [{ id: '2', key: 'X-Request-Source', value: 'postman-lite', enabled: true }],
          auth: { type: 'bearer', token: 't-secret-123' },
          body: { type: 'none' }
        },
        'smoke-1'
      )
      assert.equal(response.status, 201)
      assert.ok(Number.isFinite(response.timeMs) && response.timeMs >= 0)
      assert.ok(response.size > 0)
      assert.equal(response.truncated, false)
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers.authorization, 'Bearer t-secret-123')
      assert.equal(echo.headers['x-request-source'], 'postman-lite')
      assert.ok(echo.url.includes('page=2'))
      const served = response.headers.find((h) => h.key.toLowerCase() === 'x-served-by')
      assert.equal(served.value, 'smoke')
    })

    await check('sendRequest отправляет form-data так, как собрал buildRequest', async () => {
      const response = await http.sendRequest(
        {
          method: 'POST',
          url: `${base}/form`,
          body: {
            type: 'form-data',
            form: [
              { id: '1', key: 'field1', value: 'value1', enabled: true },
              { id: '2', key: 'field2', value: 'value2', enabled: true }
            ]
          }
        },
        'smoke-2'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers['content-type'].startsWith('multipart/form-data; boundary='), true)
      assert.ok(echo.body.includes('name="field1"'), 'сервер получил часть field1')
      assert.ok(echo.body.includes('value2'), 'сервер получил значение field2')
    })

    await check('sendRequest: cancelRequest прерывает выполнение кодом ABORTED', async () => {
      const pending = http.sendRequest({ method: 'GET', url: `${base}/slow` }, 'smoke-3')
      http.cancelRequest('smoke-3')
      await assert.rejects(pending, (err) => err.code === 'ABORTED')
    })

    await check('sendRequest: таймаут даёт код TIMEOUT', async () => {
      await assert.rejects(
        () => http.sendRequest({ method: 'GET', url: `${base}/hang` }, 'smoke-4', { timeoutMs: 100 }),
        (err) => err.code === 'TIMEOUT'
      )
    })

    await check('sendRequest: недоступный сервер даёт код NETWORK', async () => {
      // Порт 1 на 127.0.0.1 практически наверняка закрыт — соединение будет отклонено.
      await assert.rejects(
        () => http.sendRequest({ method: 'GET', url: 'http://127.0.0.1:1/nope' }, 'smoke-5'),
        (err) => err.code === 'NETWORK'
      )
    })

    await check('sendRequest: GET с телом отправляется без тела (как в Postman)', async () => {
      const response = await http.sendRequest(
        {
          method: 'GET',
          url: `${base}/get-with-body`,
          body: { type: 'json', json: '{"ignored":true}' }
        },
        'smoke-7'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.body, '', 'тело GET не ушло на сервер')
    })

    await check('sendRequest обрезает тело по лимиту и помечает truncated', async () => {
      const response = await http.sendRequest({ method: 'GET', url: `${base}/big` }, 'smoke-6', { bodyLimit: 1000 })
      assert.equal(response.size, 1000)
      assert.equal(response.body.length, 1000)
      assert.equal(response.truncated, true)
    })

    // --- Формат JSON (lib/format.js) ---

    await check('escapeHtml экранирует HTML-опасные символы', () => {
      assert.equal(
        format.escapeHtml(`<script>"'</script>`),
        '&lt;script&gt;&quot;&#39;&lt;/script&gt;'
      )
    })

    await check('prettyJson форматирует валидный JSON и возвращает null для невалидного', () => {
      assert.equal(format.prettyJson('{"a":1}'), '{\n  "a": 1\n}')
      assert.equal(format.prettyJson('не json'), null)
    })

    await check('highlightJson раскрашивает токены и экранирует содержимое строк', () => {
      const html = format.highlightJson('{"name":"<b>Ann</b>","age":30,"ok":true}')
      assert.ok(html.includes('<span class="tok-key">'), 'ключ раскрашен')
      assert.ok(html.includes('&lt;b&gt;Ann&lt;/b&gt;'), 'строка экранирована, XSS не пройдёт')
      assert.ok(html.includes('<span class="tok-number">30</span>'))
      assert.ok(html.includes('<span class="tok-bool">true</span>'))
      assert.ok(!html.includes('<b>'), 'сырой HTML в вывод не попадает')
    })

    // --- Дефолтные заголовки (lib/defaults.js) ---

    await check('DEFAULT_HEADERS: три включённых стандартных заголовка', () => {
      const keys = defaults.DEFAULT_HEADERS.map((h) => h.key)
      assert.deepEqual(keys, ['User-Agent', 'Accept', 'Accept-Language'])
      for (const header of defaults.DEFAULT_HEADERS) {
        assert.equal(header.enabled, true)
        assert.ok(header.key && header.value, 'ключ и значение заполнены')
      }
    })

    await check('DEFAULT_HEADERS отправляются вместо автозаголовков undici, без дублирования', async () => {
      const response = await http.sendRequest(
        { method: 'GET', url: `${base}/defaults`, headers: defaults.DEFAULT_HEADERS },
        'smoke-default-headers'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers['user-agent'], 'PostmanLite/1.0')
      // Ровно одно значение — undici не добавил своё */* рядом с нашим Accept.
      assert.equal(echo.headers['accept'], 'application/json')
      assert.equal(echo.headers['accept-language'], 'ru-RU,ru;q=0.9')
    })

    await check('suggestRequestName: сегмент пути, hostname, невалидный URL', () => {
      assert.equal(requestName.suggestRequestName('https://example.com/api/users'), 'users')
      assert.equal(requestName.suggestRequestName('https://example.com/users?page=2'), 'users')
      assert.equal(requestName.suggestRequestName('https://example.com'), 'example.com')
      assert.equal(requestName.suggestRequestName('не URL'), '')
      assert.equal(requestName.suggestRequestName(''), '')
    })

    // --- Подстановка переменных окружения (lib/variables.js) ---

    await check('applyEnvironment подставляет url/params/headers/auth/body, выключенная — литерально', () => {
      const vars = variables.buildVars([
        { key: 'baseUrl', value: 'http://localhost:4545', enabled: true },
        { key: 'token', value: 't-1', enabled: true },
        { key: 'page', value: '2', enabled: true },
        { key: 'debug', value: '1', enabled: false }
      ])
      const resolved = variables.applyEnvironment(
        {
          url: '{{baseUrl}}/echo?page={{page}}',
          params: [{ id: 'p1', key: 'page', value: '{{page}}', enabled: true }],
          headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
          auth: { type: 'bearer', token: '{{token}}' },
          body: { type: 'json', json: '{"page":"{{page}}","debug":"{{debug}}"}' }
        },
        vars
      )
      assert.equal(resolved.url, 'http://localhost:4545/echo?page=2')
      assert.equal(resolved.params[0].value, '2')
      assert.equal(resolved.headers[0].value, 'Bearer t-1')
      assert.equal(resolved.auth.token, 't-1', 'auth-token подставляется')
      assert.equal(resolved.body.json, '{"page":"2","debug":"{{debug}}"}', 'выключенная переменная не подставляется')
    })

    await check('applyEnvironment: пустой словарь и неразрешённые плейсхолдеры литеральны', () => {
      const resolved = variables.applyEnvironment(
        { url: '{{baseUrl}}/x', params: [], headers: [], body: { type: 'text', text: '{{a}}{{b}}' } },
        variables.buildVars([])
      )
      assert.equal(resolved.url, '{{baseUrl}}/x')
      assert.equal(resolved.body.text, '{{a}}{{b}}')
    })

    await check('applyEnvironment подставляет ключи и значения в активном слоте body', () => {
      const vars = variables.buildVars([
        { key: 'k', value: 'fieldX', enabled: true },
        { key: 'v', value: 'valY', enabled: true }
      ])
      const formData = variables.applyEnvironment(
        {
          url: 'http://x',
          params: [],
          headers: [],
          body: { type: 'form-data', form: [{ id: 'f1', key: '{{k}}', value: '{{v}}', enabled: true }] }
        },
        vars
      )
      assert.equal(formData.body.form[0].key, 'fieldX')
      assert.equal(formData.body.form[0].value, 'valY')

      const urlencoded = variables.applyEnvironment(
        {
          url: 'http://x',
          params: [],
          headers: [],
          body: { type: 'urlencoded', urlencoded: [{ id: 'u1', key: '{{k}}', value: '{{v}}', enabled: true }] }
        },
        vars
      )
      assert.equal(urlencoded.body.urlencoded[0].key, 'fieldX')
      assert.equal(urlencoded.body.urlencoded[0].value, 'valY')
    })

    // --- curl: парсер (lib/curl.js) ---

    await check('parseCurl: типичная команда -X/-H/-d json', () => {
      const snapshot = curl.parseCurl(
        `curl -X POST 'https://api.example.com/users' -H 'Authorization: Bearer t-1' -H 'Content-Type: application/json' -d '{"name":"Ann"}'`
      )
      assert.equal(snapshot.method, 'POST')
      assert.equal(snapshot.url, 'https://api.example.com/users')
      assert.equal(snapshot.headers.length, 2)
      assert.equal(snapshot.headers[0].key, 'Authorization')
      assert.equal(snapshot.headers[0].value, 'Bearer t-1')
      assert.equal(snapshot.body.type, 'json')
      assert.equal(snapshot.body.json, '{"name":"Ann"}')
    })

    await check('parseCurl: двойные кавычки с экранированием и многострочный перенос', () => {
      const snapshot = curl.parseCurl(
        'curl "https://api.example.com/x" \\\n  -H "X-Note: \\"quoted\\"" \\\n  -d \'plain\''
      )
      assert.equal(snapshot.url, 'https://api.example.com/x')
      const note = snapshot.headers.find((h) => h.key === 'X-Note')
      assert.equal(note.value, '"quoted"')
      assert.equal(snapshot.method, 'POST')
    })

    await check('parseCurl: -d без метода даёт POST, Content-Type по умолчанию curl', () => {
      const snapshot = curl.parseCurl(`curl https://api.example.com -d 'a=1&b=2'`)
      assert.equal(snapshot.method, 'POST')
      assert.equal(snapshot.body.type, 'text')
      assert.equal(snapshot.body.text, 'a=1&b=2')
      const ct = snapshot.headers.find((h) => h.key === 'Content-Type')
      assert.equal(ct.value, 'application/x-www-form-urlencoded')
    })

    await check('parseCurl: -u → basic, -b → Cookie', () => {
      const snapshot = curl.parseCurl(`curl -u user:pass -b 'k=v' https://api.example.com`)
      assert.equal(snapshot.auth.type, 'basic')
      assert.equal(snapshot.auth.username, 'user')
      assert.equal(snapshot.auth.password, 'pass')
      const cookie = snapshot.headers.find((h) => h.key === 'Cookie')
      assert.equal(cookie.value, 'k=v')
    })

    await check('parseCurl: -G переносит -d в query-параметры', () => {
      const snapshot = curl.parseCurl(`curl -G https://api.example.com -d 'page=2' -d 'limit=10'`)
      assert.equal(snapshot.method, 'GET')
      assert.equal(snapshot.body.type, 'none')
      assert.equal(snapshot.params.length, 2)
      assert.equal(snapshot.params[0].key, 'page')
      assert.equal(snapshot.params[1].value, '10')
    })

    await check('parseCurl: слитные формы -XPOST и --request=POST', () => {
      assert.equal(curl.parseCurl(`curl -XPOST https://x.test`).method, 'POST')
      assert.equal(curl.parseCurl(`curl --request=POST https://x.test`).method, 'POST')
    })

    await check('parseCurl: ошибка без URL и --json → тело json', () => {
      assert.throws(() => curl.parseCurl(`curl -X GET`), /не найден URL/)
      const json = curl.parseCurl(`curl --json '{"a":1}' https://x.test`)
      assert.equal(json.body.type, 'json')
      assert.equal(json.body.json, '{"a":1}')
      const ct = json.headers.find((h) => h.key === 'Content-Type')
      assert.equal(ct.value, 'application/json')
    })

    // --- curl: генератор ---

    await check('generateCurl: auth+тело, basic, экранирование, {{var}} литерально', () => {
      const command = curl.generateCurl({
        method: 'POST',
        url: '{{baseUrl}}/users',
        params: [{ id: 'p1', key: 'page', value: '2', enabled: true }],
        headers: [{ id: 'h1', key: 'X-Note', value: `it's fine`, enabled: true }],
        body: { type: 'json', json: '{"name":"Ann"}', form: [], urlencoded: [], text: '' },
        auth: { type: 'bearer', token: 't-1' },
        sslVerify: true
      })
      assert.ok(command.includes(`-X POST`))
      assert.ok(command.includes(`'{{baseUrl}}/users?page=2'`), 'params в URL, {{var}} литерально')
      assert.ok(command.includes(`-H 'Authorization: Bearer t-1'`))
      assert.ok(command.includes(`-H 'Content-Type: application/json'`))
      assert.ok(command.includes(`-d '{"name":"Ann"}'`))
      assert.ok(command.includes(`'X-Note: it'\\''s fine'`), 'экранирование одинарной кавычки')

      const basic = curl.generateCurl({
        method: 'GET',
        url: 'https://x.test',
        params: [],
        headers: [],
        body: { type: 'none' },
        auth: { type: 'basic', username: 'user', password: 'p@ss' },
        sslVerify: true
      })
      assert.ok(basic.includes(`-u 'user:p@ss'`))
      assert.ok(!basic.includes('-X'), 'GET без -X')
    })

    await check('generateCurl: urlencoded → --data-urlencode, form-data → -F, GET без тела', () => {
      const urlencoded = curl.generateCurl({
        method: 'POST',
        url: 'https://x.test/token',
        params: [],
        headers: [],
        body: { type: 'urlencoded', json: '', form: [], text: '', urlencoded: [
          { id: 'u1', key: 'grant_type', value: 'client_credentials', enabled: true },
          { id: 'u2', key: 'skip', value: 'x', enabled: false }
        ] },
        auth: { type: 'none' },
        sslVerify: true
      })
      assert.ok(urlencoded.includes(`--data-urlencode 'grant_type=client_credentials'`))
      assert.ok(!urlencoded.includes('skip'))

      const form = curl.generateCurl({
        method: 'POST',
        url: 'https://x.test',
        params: [],
        headers: [],
        body: { type: 'form-data', json: '', text: '', urlencoded: [], form: [
          { id: 'f1', key: 'field1', value: 'value1', enabled: true }
        ] },
        auth: { type: 'none' },
        sslVerify: true
      })
      assert.ok(form.includes(`-F 'field1=value1'`))

      const getWithBody = curl.generateCurl({
        method: 'GET',
        url: 'https://x.test',
        params: [],
        headers: [],
        body: { type: 'json', json: '{"x":1}', form: [], urlencoded: [], text: '' },
        auth: { type: 'none' },
        sslVerify: true
      })
      assert.ok(!getWithBody.includes('-d'), 'GET не несёт тела')
    })

    await check('curl round-trip: parse(generate(snapshot)) воспроизводит запрос', () => {
      const original = {
        name: 'Demo',
        method: 'POST',
        url: 'https://api.example.com/token?page=2',
        params: [{ id: 'p1', key: 'page', value: '2', enabled: true }],
        headers: [
          { id: 'h1', key: 'X-Trace', value: 'abc', enabled: true },
          { id: 'h2', key: 'X-Skip', value: 'no', enabled: false }
        ],
        body: { type: 'urlencoded', json: '', form: [], text: '', urlencoded: [
          { id: 'u1', key: 'grant_type', value: 'client_credentials', enabled: true },
          { id: 'u2', key: 'client_id', value: 'ab c&d', enabled: true }
        ] },
        auth: { type: 'basic', username: 'user', password: 'pass word' },
        sslVerify: true
      }
      const command = curl.generateCurl(original)
      const parsed = curl.parseCurl(command)
      assert.equal(parsed.method, 'POST')
      // Эффективный URL: оригинал отправлял бы query из URL + params таблицы (дубль page=2);
      // после round-trip параметры живут в URL — эффективный запрос тот же.
      assert.equal(parsed.url, 'https://api.example.com/token?page=2&page=2', 'эффективный URL сохранён')
      assert.equal(parsed.params.length, 0, 'params переехали в URL при re-import')
      const trace = parsed.headers.find((h) => h.key === 'X-Trace')
      assert.equal(trace.value, 'abc')
      assert.ok(!parsed.headers.some((h) => h.key === 'X-Skip'), 'выключенный заголовок не экспортируется')
      assert.equal(parsed.body.type, 'urlencoded')
      const grant = parsed.body.urlencoded.find((r) => r.key === 'grant_type')
      assert.equal(grant.value, 'client_credentials')
      const clientId = parsed.body.urlencoded.find((r) => r.key === 'client_id')
      assert.equal(clientId.value, 'ab c&d', '--data-urlencode ↔ URLSearchParams кодирование согласовано')
      assert.equal(parsed.auth.type, 'basic')
      assert.equal(parsed.auth.password, 'pass word')
    })
  } finally {
    await closeServer()
  }

  console.log(`\nSMOKE OK: ${passed} проверок пройдено`)
} finally {
  await rm(root, { recursive: true, force: true })
}
