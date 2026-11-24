// Мок-сервер: принимает запросы, отвечает JSON из конфига и логирует всё пришедшее (тело, заголовки).
// Запуск: node scripts/mock-server.mjs [--port 4546] [--config <путь>] [--log-file <путь>]
//
// Управление ответами — двумя способами:
//   1) правкой конфига на лету: файл перечитывается на каждый запрос, рестарт не нужен;
//   2) админ-API (сами админ-запросы в лог не пишутся):
//        GET    /__admin/config      — показать текущий конфиг
//        PUT    /__admin/config      — заменить конфиг (JSON в теле, сохраняется в файл)
//        GET    /__admin/requests    — лог принятых запросов (последние N, ?limit=50)
//        DELETE /__admin/requests    — очистить лог
//
// Формат конфига: { routes: [{method?, path, status?, headers?, body?, delayMs?}], defaultResponse? }
// Совпадение маршрута — по точному пути (query-строка игнорируется); method не задан — любой.
import { createServer } from 'node:http'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const hasArg = (name) => args.includes(name)

const PORT = Number(argValue('--port', process.env.MOCK_PORT || 4546))
const CONFIG_PATH = resolve(argValue('--config', join(__dirname, 'mock-server.config.json')))
const LOG_FILE = hasArg('--log-file') ? resolve(argValue('--log-file')) : null

const LOG_LIMIT = 1000 // максимум записей в буфере лога
const log = []

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { routes: [] }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
}

// Запись JSON — атомарная (tmp + rename), как в storage.js
function saveConfig(config) {
  const tmp = CONFIG_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  renameSync(tmp, CONFIG_PATH)
}

function appendLog(entry) {
  log.push(entry)
  if (log.length > LOG_LIMIT) log.shift()
  if (LOG_FILE) writeFileSync(LOG_FILE, JSON.stringify(entry) + '\n', { flag: 'a' })
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolveBody(''))
  })
}

// Тело в лог кладём как распарсенный JSON, если получилось; иначе сырая строка
function parseBody(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text === '' ? null : text
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  res.end(body)
}

async function handleAdmin(pathname, searchParams, method, body, res) {
  if (pathname === '/__admin/config' && method === 'GET') {
    return sendJson(res, 200, loadConfig())
  }
  if (pathname === '/__admin/config' && method === 'PUT') {
    const config = parseBody(body)
    if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.routes)) {
      return sendJson(res, 400, { error: 'Ожидается JSON вида { "routes": [...], "defaultResponse": {...} }' })
    }
    saveConfig(config)
    return sendJson(res, 200, { ok: true, routes: config.routes.length })
  }
  if (pathname === '/__admin/requests' && method === 'GET') {
    const limit = Number(searchParams.get('limit')) || log.length
    return sendJson(res, 200, { total: log.length, requests: log.slice(-limit) })
  }
  if (pathname === '/__admin/requests' && method === 'DELETE') {
    log.length = 0
    return sendJson(res, 200, { ok: true })
  }
  return sendJson(res, 404, {
    error: 'Неизвестный админ-эндпоинт',
    available: ['GET|PUT /__admin/config', 'GET|DELETE /__admin/requests']
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const body = await readBody(req)

  if (url.pathname.startsWith('/__admin')) {
    return handleAdmin(url.pathname, url.searchParams, req.method, body, res)
  }

  let config
  try {
    config = loadConfig()
  } catch (err) {
    return sendJson(res, 500, { error: `Ошибка чтения конфига: ${err.message}` })
  }

  const route = (config.routes || []).find(
    (r) => (!r.method || r.method.toUpperCase() === req.method) && r.path === url.pathname
  )
  const response = route || config.defaultResponse || { status: 404 }

  const status = response.status || (route ? 200 : 404)
  const payload = response.body === undefined
    ? (route ? null : { error: 'Нет маршрута', method: req.method, path: url.pathname })
    : response.body
  const headers = response.headers || {}

  const entry = {
    ts: new Date().toISOString(),
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: parseBody(body)
  }
  appendLog(entry)
  console.log(`[${entry.ts}] ${req.method} ${req.url} → ${status} (${route ? `маршрут ${route.path}` : 'defaultResponse'})`)

  if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs))
  sendJson(res, status, payload, headers)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Мок-сервер запущен: http://127.0.0.1:${PORT}`)
  console.log(`Конфиг: ${CONFIG_PATH} — перечитывается на каждый запрос, правки применяются без рестарта`)
  console.log(`Лог: GET http://127.0.0.1:${PORT}/__admin/requests${LOG_FILE ? ` + файл ${LOG_FILE}` : ''}`)
})
