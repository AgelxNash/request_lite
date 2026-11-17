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
async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, filePath)
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
  const project = { id: randomUUID(), name: trimmed, createdAt: now, updatedAt: now }
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
  const next = projects.filter((p) => p.id !== id)
  if (next.length === projects.length) throw new Error(`Проект не найден: ${id}`)
  await writeJsonAtomic(indexPath(), next)
  await rm(projectPath(id), { force: true })
  return true
}

export async function getProject(id) {
  return readJson(projectPath(id), null)
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
