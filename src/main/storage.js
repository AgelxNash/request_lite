// JSON-хранилище приложения.
// Не зависит от Electron: корневой путь передаётся через initStorage —
// так smoke-тесты (scripts/smoke.mjs) гоняют те же функции на временной папке.
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

let rootPath = null
let settingsCache = null

const DEFAULT_SETTINGS = { theme: 'dark' }

export function initStorage(root) {
  rootPath = root
}

export function getStorageRoot() {
  if (!rootPath) throw new Error('Хранилище не инициализировано: сначала вызовите initStorage()')
  return rootPath
}

// Инициализация каталогов и кэша настроек. Вызывается один раз при старте main-процесса.
export async function bootstrap() {
  await ensureDirs()
  settingsCache = await readSettingsFromDisk()
}

async function ensureDirs() {
  await mkdir(join(getStorageRoot(), 'projects'), { recursive: true })
}

// Атомарная запись: сначала во временный файл, затем rename поверх целевого.
// Ретрай на EPERM: на Windows rename может упасть, если файл на мгновение держит
// антивирус или индексатор — повторяем попытку до 3 раз с паузой.
async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tmp, filePath)
      return
    } catch (err) {
      if (err.code !== 'EPERM' || attempt >= 3) throw err
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

// Чтение JSON с защитой данных: невалидный файл НЕ перезаписывается —
// наверх уходит ошибка CORRUPT_STORAGE, чтобы сбой записи не привёл к тихой потере данных.
async function readJson(filePath, fallback) {
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error(
      `Файл хранилища повреждён: ${filePath}. Он не был перезаписан — исправьте или переместите файл вручную.`
    )
    error.code = 'CORRUPT_STORAGE'
    throw error
  }
}

const indexPath = () => join(getStorageRoot(), 'projects.json')
const projectPath = (id) => join(getStorageRoot(), 'projects', `${id}.json`)
const settingsPath = () => join(getStorageRoot(), 'settings.json')

// --- Проекты ---

export async function listProjects() {
  await ensureDirs()
  return readJson(indexPath(), [])
}

export async function createProject(name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new Error('Имя проекта не может быть пустым')
  await ensureDirs()
  const now = new Date().toISOString()
  const project = { id: randomUUID(), name: trimmed, createdAt: now, updatedAt: now, locked: false }
  const projects = await listProjects()
  projects.push(project)
  await writeJsonAtomic(indexPath(), projects)
  await writeJsonAtomic(projectPath(project.id), {
    requests: [],
    environments: [],
    activeEnvId: null
  })
  return project
}

export async function renameProject(id, name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new Error('Имя проекта не может быть пустым')
  const projects = await listProjects()
  const project = projects.find((p) => p.id === id)
  if (!project) throw new Error(`Проект не найден: ${id}`)
  project.name = trimmed
  project.updatedAt = new Date().toISOString()
  await writeJsonAtomic(indexPath(), projects)
  return project
}

export async function deleteProject(id) {
  const projects = await listProjects()
  const project = projects.find((p) => p.id === id)
  if (!project) throw new Error(`Проект не найден: ${id}`)
  // Guard до мутаций: заблокированный проект не удаляется даже минуя UI.
  if (project.locked === true) throw new Error('Проект заблокирован')
  const next = projects.filter((p) => p.id !== id)
  await writeJsonAtomic(indexPath(), next)
  await rm(projectPath(id), { force: true })
  return true
}

// Блокировка проекта (защита от удаления). Флаг живёт в индексе.
export async function setProjectLocked(id, locked) {
  if (typeof locked !== 'boolean') throw new Error('locked должен быть boolean')
  const projects = await listProjects()
  const project = projects.find((p) => p.id === id)
  if (!project) throw new Error(`Проект не найден: ${id}`)
  project.locked = locked
  project.updatedAt = new Date().toISOString()
  await writeJsonAtomic(indexPath(), projects)
  return project
}

// Bulk-импорт коллекции Postman: проект в индексе + файл проекта
// (requests[] + окружение с именем коллекции + activeEnvId) одной атомарной записью.
export async function importCollection({ name, requests, variables }) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new Error('Имя проекта не может быть пустым')
  await ensureDirs()
  const now = new Date().toISOString()
  const project = { id: randomUUID(), name: trimmed, createdAt: now, updatedAt: now, locked: false }
  const environment = {
    id: randomUUID(),
    name: trimmed,
    variables: (variables ?? []).map((v) => ({
      id: String(v.id ?? randomUUID()),
      key: String(v.key ?? ''),
      value: String(v.value ?? ''),
      enabled: v.enabled !== false
    }))
  }
  const records = (requests ?? []).map((r) => ({
    id: String(r.id ?? randomUUID()),
    name: String(r.name ?? '').trim() || 'Imported Request',
    method: r.method ?? 'GET',
    url: r.url ?? '',
    params: r.params ?? [],
    headers: r.headers ?? [],
    body: r.body ?? { type: 'none' },
    auth: r.auth ?? { type: 'none' },
    sslVerify: r.sslVerify !== false,
    locked: false
  }))
  const projects = await listProjects()
  projects.push(project)
  await writeJsonAtomic(indexPath(), projects)
  await writeJsonAtomic(projectPath(project.id), {
    requests: records,
    environments: [environment],
    activeEnvId: environment.id
  })
  return project
}

export async function getProject(id) {
  return readJson(projectPath(id), null)
}

// --- Запросы проекта ---

async function requireProject(projectId) {
  const project = await getProject(projectId)
  if (!project) throw new Error(`Проект не найден: ${projectId}`)
  return project
}

export async function listRequests(projectId) {
  const project = await requireProject(projectId)
  return project.requests ?? []
}

// Upsert по id: замена существующей записи на её позиции или добавление в конец списка.
// Обновление СУЩЕСТВУЮЩЕГО заблокированного запроса отклоняется (см. setRequestLocked);
// создание нового запроса (id не из списка) не ограничивается.
export async function saveRequest(projectId, request) {
  const name = String(request?.name ?? '').trim()
  if (!name) throw new Error('Имя запроса не может быть пустым')
  if (!request.id) throw new Error('У сохраняемого запроса должен быть id')
  const project = await requireProject(projectId)
  const stored = {
    id: String(request.id),
    name,
    method: request.method ?? 'GET',
    url: request.url ?? '',
    params: request.params ?? [],
    headers: request.headers ?? [],
    body: request.body ?? { type: 'none' },
    auth: request.auth ?? { type: 'none' },
    sslVerify: request.sslVerify !== false
  }
  const requests = project.requests ?? []
  const index = requests.findIndex((r) => r.id === stored.id)
  if (index === -1) {
    requests.push({ ...stored, locked: false })
  } else {
    // Guard до мутаций: заблокированный запрос нельзя обновить даже минуя UI.
    if (requests[index].locked === true) throw new Error('Запрос заблокирован')
    // Флаг блокировки — метаданные записи: не сбрасывается при сохранении содержимого.
    requests[index] = { ...stored, locked: requests[index].locked === true }
  }
  await writeJsonAtomic(projectPath(projectId), { ...project, requests })
  return requests
}

// Удаление заблокированного запроса отклоняется (см. setRequestLocked).
export async function deleteRequest(projectId, requestId) {
  const project = await requireProject(projectId)
  const requests = project.requests ?? []
  const existing = requests.find((r) => r.id === requestId)
  if (!existing) throw new Error(`Запрос не найден: ${requestId}`)
  if (existing.locked === true) throw new Error('Запрос заблокирован')
  const next = requests.filter((r) => r.id !== requestId)
  await writeJsonAtomic(projectPath(projectId), { ...project, requests: next })
  return next
}

// Блокировка запроса (защита от обновления и удаления). Флаг — метаданные записи.
export async function setRequestLocked(projectId, requestId, locked) {
  if (typeof locked !== 'boolean') throw new Error('locked должен быть boolean')
  const project = await requireProject(projectId)
  const requests = project.requests ?? []
  const existing = requests.find((r) => r.id === requestId)
  if (!existing) throw new Error(`Запрос не найден: ${requestId}`)
  existing.locked = locked
  await writeJsonAtomic(projectPath(projectId), { ...project, requests })
  return requests
}

// Перемещение запроса на новую позицию в списке проекта. Перемещение меняет только
// порядок массива — содержимое и флаги locked записей не трогаются, поэтому замки
// запросов и блокировка проекта (защита содержимого и удаления, см. спеки) не мешают.
export async function reorderRequests(projectId, requestId, toIndex) {
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('У перемещаемого запроса должен быть id')
  }
  if (!Number.isInteger(toIndex) || toIndex < 0) {
    throw new Error('toIndex должен быть целым числом >= 0')
  }
  const project = await requireProject(projectId)
  const requests = project.requests ?? []
  const from = requests.findIndex((r) => r.id === requestId)
  if (from === -1) throw new Error(`Запрос не найден: ${requestId}`)
  const to = Math.min(toIndex, requests.length - 1)
  if (to === from) return requests
  const [moved] = requests.splice(from, 1)
  requests.splice(to, 0, moved)
  await writeJsonAtomic(projectPath(projectId), { ...project, requests })
  return requests
}

// --- Окружения проекта ---

export async function listEnvironments(projectId) {
  const project = await requireProject(projectId)
  return { environments: project.environments ?? [], activeEnvId: project.activeEnvId ?? null }
}

// Upsert по id: замена существующей записи на её позиции или добавление в конец списка.
export async function saveEnvironment(projectId, environment) {
  const name = String(environment?.name ?? '').trim()
  if (!name) throw new Error('Имя окружения не может быть пустым')
  if (!environment.id) throw new Error('У сохраняемого окружения должен быть id')
  const project = await requireProject(projectId)
  const stored = {
    id: String(environment.id),
    name,
    variables: environment.variables ?? []
  }
  const environments = project.environments ?? []
  const index = environments.findIndex((e) => e.id === stored.id)
  if (index === -1) environments.push(stored)
  else environments[index] = stored
  await writeJsonAtomic(projectPath(projectId), { ...project, environments })
  return environments
}

// Удаление окружения; если удалили активное — activeEnvId обнуляется.
export async function deleteEnvironment(projectId, environmentId) {
  const project = await requireProject(projectId)
  const environments = project.environments ?? []
  const next = environments.filter((e) => e.id !== environmentId)
  if (next.length === environments.length) throw new Error(`Окружение не найдено: ${environmentId}`)
  const activeEnvId = project.activeEnvId === environmentId ? null : project.activeEnvId ?? null
  await writeJsonAtomic(projectPath(projectId), { ...project, environments: next, activeEnvId })
  return { environments: next, activeEnvId }
}

export async function setActiveEnvironment(projectId, environmentId) {
  const project = await requireProject(projectId)
  const environments = project.environments ?? []
  if (environmentId !== null && !environments.some((e) => e.id === environmentId)) {
    throw new Error(`Окружение не найдено: ${environmentId}`)
  }
  const activeEnvId = environmentId
  await writeJsonAtomic(projectPath(projectId), { ...project, activeEnvId })
  return { environments, activeEnvId }
}

// --- Настройки ---

async function readSettingsFromDisk() {
  const stored = await readJson(settingsPath(), {})
  return { ...DEFAULT_SETTINGS, ...stored }
}

// Синхронный доступ для preload (sendSync при старте окна, тема до первого кадра).
export function getSettingsSync() {
  if (!settingsCache) return { ...DEFAULT_SETTINGS }
  return { ...settingsCache }
}

export async function getSettings() {
  if (!settingsCache) await bootstrap()
  return getSettingsSync()
}

export async function setSettings(patch) {
  if (!settingsCache) await bootstrap()
  settingsCache = { ...settingsCache, ...patch }
  await writeJsonAtomic(settingsPath(), settingsCache)
  return { ...settingsCache }
}
