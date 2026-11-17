// Смоук-тесты хранилища: чистый Node, без Electron.
// Запуск: node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storage = await import('../src/main/storage.js')

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

  console.log(`\nSMOKE OK: ${passed} проверок пройдено`)
} finally {
  await rm(root, { recursive: true, force: true })
}
