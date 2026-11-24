// Встроенный мок-сервер: HTTP-сервер с ответами из мок-проекта и журналом входящих запросов.
// Не зависит от Electron — конфиг читается из storage.js, smoke-тесты импортируют модуль в чистом Node
// (образец: mcp.js). Один активный экземпляр: старт нового останавливает предыдущий.
// Конфигурация держится in-memory снимком; applyMockConfig подменяет его без рестарта слушателя.
import { createServer } from 'node:http'
import { getMockProject } from './storage.js'

const DEFAULT_PORT = 4547
const LOG_LIMIT = 500

let server = null
let port = null
let projectId = null
let state = 'stopped' // 'stopped' | 'running' | 'error'
let stateMessage = ''
let config = { routes: [], defaultResponse: null }
let logListener = null
const log = []

export function getMockStatus() {
  const status = { state, message: stateMessage, port, projectId, defaultPort: DEFAULT_PORT }
  if (state === 'running') status.address = `http://127.0.0.1:${port}`
  return status
}

// Мутации (старт/стоп/применение конфига) идут через последовательную очередь,
// чтобы быстрый Start/Stop в UI не создал race между закрытием и открытием порта.
let mutationChain = Promise.resolve()
function enqueueMutation(fn) {
  const run = mutationChain.then(fn, fn)
  mutationChain = run.catch(() => {})
  return run
}

function normalizePort(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error(`Некорректный порт: ${value}. Ожидается целое число 1024–65535`)
  }
  return n
}

function stopListening() {
  const s = server
  server = null
  state = 'stopped'
  stateMessage = ''
  if (!s) return Promise.resolve()
  s.closeAllConnections()
  return new Promise((resolve) => s.close(resolve))
}

export function startMockServer({ projectId: desiredProjectId, port: desiredPort } = {}) {
  return enqueueMutation(async () => {
    // Валидация до остановки текущего слушателя: невалидный порт не должен ронять работающий сервер.
    const p = normalizePort(desiredPort ?? DEFAULT_PORT)
    await stopListening()
    const project = await getMockProject(desiredProjectId)
    if (!project) throw new Error(`Мок-проект не найден: ${desiredProjectId}`)
    config = { routes: project.routes ?? [], defaultResponse: project.defaultResponse ?? null }
    projectId = desiredProjectId
    port = p
    await new Promise((resolve) => {
      const s = createServer(handleRequest)
      s.once('error', (err) => {
        // Занятый порт — не исключение наверх, а статус 'error' (см. mcp.js): UI показывает сообщение.
        state = 'error'
        stateMessage = err.code === 'EADDRINUSE' ? `Порт ${p} занят другим процессом` : String(err.message ?? err)
        server = null
        resolve()
      })
      server = s
      s.listen(p, '127.0.0.1', () => {
        state = 'running'
        stateMessage = ''
        resolve()
      })
    })
    return getMockStatus()
  })
}

export function stopMockServer() {
  return enqueueMutation(async () => {
    await stopListening()
    return getMockStatus()
  })
}

// Подмена конфигурации запущенного сервера без рестарта: следующий запрос
// уже обрабатывается по новому снимку. Вызывается IPC-слоем после сохранения
// конфигурации в storage, когда сервер запущен на этом же мок-проекте.
export function applyMockConfig(nextConfig) {
  return enqueueMutation(async () => {
    if (state === 'running') {
      config = {
        routes: nextConfig?.routes ?? [],
        defaultResponse: nextConfig?.defaultResponse ?? null
      }
    }
    return getMockStatus()
  })
}

export function getMockLog() {
  return [...log]
}

export function clearMockLog() {
  log.length = 0
  return true
}

export function setLogListener(fn) {
  logListener = typeof fn === 'function' ? fn : null
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

// Тело в журнале хранится распарсенным JSON, если возможно; иначе сырая строка.
function parseBody(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text === '' ? null : text
  }
}

function appendLog(entry) {
  log.push(entry)
  if (log.length > LOG_LIMIT) log.shift()
  try {
    logListener?.(entry)
  } catch {
    // Ошибка подписчика (например, окно уже закрыто) не должна ронять сервер.
  }
}

function findRoute(method, pathname) {
  return config.routes.find(
    (r) => (!r.method || r.method === method.toUpperCase()) && r.path === pathname
  )
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost')
    const rawBody = await readBody(req)
    const route = findRoute(req.method, url.pathname)
    const response = route ?? config.defaultResponse

    // Журнал — факт приёма: пишем до задержки и до отправки ответа.
    appendLog({
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: parseBody(rawBody)
    })

    const status = response?.status ?? 404
    const payload = response?.body ??
      (route ? null : { error: 'Нет маршрута', method: req.method, path: url.pathname })
    // Заголовки маршрута перекрывают content-type по умолчанию;
    // ключи приводятся к нижнему регистру, чтобы не ушли дубликаты одного заголовка.
    const headers = { 'content-type': 'application/json; charset=utf-8' }
    for (const h of route?.headers ?? []) {
      if (h?.enabled !== false && h?.key) headers[String(h.key).toLowerCase()] = String(h.value)
    }

    const delay = Number(response?.delayMs) || 0
    if (delay > 0) await new Promise((done) => setTimeout(done, delay))
    res.writeHead(status, headers)
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: String(err.message ?? err) }))
  }
}
