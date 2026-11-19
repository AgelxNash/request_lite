// MCP-сервер (Model Context Protocol) поверх Streamable HTTP — внешний вход для ИИ-агентов.
// Работает ТОЛЬКО в main-процессе и не зависит от Electron: smoke-тесты (scripts/smoke.mjs)
// гоняют его в чистом Node, паттерн storage.js/http.js.
// Реализуем узкий поднабор протокола на JSON-RPC 2.0 (design.md D2): initialize,
// notifications/initialized, ping, tools/list, tools/call — без SDK и без SSE:
// все операции укладываются в один application/json-ответ.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import * as storage from './storage.js'
import { sendRequest } from './http.js'
// Чистые модули без зависимостей (smoke-тесты уже импортируют их в Node) — design.md D7.
import { buildVars, applyEnvironment } from '../renderer/src/lib/variables.js'
import { parseCurl, generateCurl } from '../renderer/src/lib/curl.js'

const PROTOCOL_VERSION = '2025-06-18'

const DEFAULT_PORT = 45460
const PORT_MIN = 1024
const PORT_MAX = 65535
// Тело HTTP-ответа урезается для агента (design.md D8): лимитные 10 МБ из http.js
// разом съедают контекст модели.
const MCP_BODY_LIMIT = 100 * 1024
// Защита самого MCP-эндпоинта: JSON-RPC запрос крупнее не имеет смысла.
const RPC_BODY_LIMIT = 1024 * 1024

const RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INTERNAL: -32603
}

// Версия приложения для serverInfo: package.json лежит на два уровня выше и в dev
// (src/main), и в сборке (out/main внутри app.asar).
let appVersion = '0.0.0'
try {
  appVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
} catch {
  // вне пакета/репозитория — остаётся заглушка
}

// --- Состояние слушателя ---

let server = null // node:http server, пока слушает
let port = null // фактический порт
let token = null // текущий токен доступа
let state = 'stopped' // 'stopped' | 'running' | 'error'
let stateMessage = '' // текст ошибки (порт занят и т.п.)

export function getMcpStatus() {
  return {
    state, // фактическое состояние слушателя — UI различает «включён» и «ошибка: порт занят»
    message: stateMessage,
    address: state === 'running' ? `http://127.0.0.1:${port}/mcp` : null,
    port,
    token // для блока информации о подключении на странице настроек
  }
}

function normalizePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`Порт должен быть целым числом ${PORT_MIN}–${PORT_MAX}`)
  }
  return port
}

// --- Инструменты для агента ---

// Снимок сохранённого запроса с подстановкой {{var}} активного окружения проекта
// (тот же конвейер, что у отправки из UI — design.md D7).
async function resolveSnapshot(projectId, stored) {
  const { environments, activeEnvId } = await storage.listEnvironments(projectId)
  const active = environments.find((env) => env.id === activeEnvId) ?? null
  return applyEnvironment(stored, buildVars(active?.variables))
}

// Произвольный запрос от агента: заголовки — карта {имя: значение}, тело — сырая строка
// (type 'text'; если агент задал свой Content-Type в заголовках, он выигрывает — см. buildRequest).
function snapshotFromAdhoc(args) {
  const headers = Object.entries(args?.headers ?? {}).map(([key, value]) => ({
    id: randomUUID(),
    key: String(key),
    value: String(value),
    enabled: true
  }))
  const rawBody = args?.body
  const body =
    rawBody === undefined || rawBody === null || String(rawBody) === ''
      ? { type: 'none' }
      : { type: 'text', text: String(rawBody) }
  return {
    method: String(args?.method ?? 'GET'),
    url: String(args?.url ?? ''),
    params: [],
    headers,
    body,
    auth: { type: 'none' },
    sslVerify: true
  }
}

// Усечение тела ответа до лимита агента с пометкой и фактическим размером.
function capBody(response) {
  if (!response || typeof response.body !== 'string' || response.body.length <= MCP_BODY_LIMIT) {
    return response
  }
  return { ...response, body: response.body.slice(0, MCP_BODY_LIMIT), truncated: true, actualSize: response.size }
}

// Обязательный id: saveRequest требует id — генерируем для нового запроса агента.
function requireRequestName(incoming) {
  const name = String(incoming?.name ?? '').trim()
  if (!name) throw new Error('Имя запроса не может быть пустым')
  return name
}

// Реестр инструментов — единый источник для tools/list и tools/call (design.md D4).
const TOOLS = [
  {
    name: 'list_projects',
    description: 'Список проектов Request Lite с идентификаторами, именами и флагами locked/pinned.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => storage.listProjects()
  },
  {
    name: 'list_requests',
    description: 'Список запросов проекта в порядке хранения, с флагами locked/pinned.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string', description: 'Идентификатор проекта' } }
    },
    handler: async ({ projectId }) => storage.listRequests(projectId)
  },
  {
    name: 'get_request',
    description: 'Полное содержимое сохранённого запроса: метод, URL, params, headers, body, auth.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'requestId'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        requestId: { type: 'string', description: 'Идентификатор запроса' }
      }
    },
    handler: async ({ projectId, requestId }) => {
      const stored = (await storage.listRequests(projectId)).find((r) => r.id === String(requestId))
      if (!stored) throw new Error(`Запрос не найден: ${requestId}`)
      return stored
    }
  },
  {
    name: 'list_environments',
    description: 'Окружения проекта с переменными и пометкой активного.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string', description: 'Идентификатор проекта' } }
    },
    handler: async ({ projectId }) => storage.listEnvironments(projectId)
  },
  {
    name: 'create_request',
    description: 'Создать запрос в проекте (id генерируется, если не задан). Имя обязательно.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'request'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        request: {
          type: 'object',
          description: 'Снимок запроса: {name, method, url, params?, headers?, body?, auth?, sslVerify?}'
        }
      }
    },
    handler: ({ projectId, request }) => {
      const incoming = request ?? {}
      const id = incoming.id ? String(incoming.id) : randomUUID()
      return enqueueMutation(() => storage.saveRequest(projectId, { ...incoming, id, name: requireRequestName(incoming) }))
    }
  },
  {
    name: 'update_request',
    description:
      'Обновить существующий запрос по id. Заблокированный (locked) запрос обновить нельзя — вернётся ошибка.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'request'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        request: { type: 'object', description: 'Снимок запроса с обязательным id' }
      }
    },
    handler: ({ projectId, request }) => {
      const incoming = request ?? {}
      if (!incoming.id) throw new Error('Для обновления нужен id запроса')
      const id = String(incoming.id)
      return enqueueMutation(async () => {
        const existing = (await storage.listRequests(projectId)).find((r) => r.id === id)
        if (!existing) throw new Error(`Запрос не найден: ${id}`)
        return storage.saveRequest(projectId, { ...incoming, id })
      })
    }
  },
  {
    name: 'delete_request',
    description: 'Удалить запрос из проекта. Заблокированный (locked) запрос удалить нельзя.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'requestId'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        requestId: { type: 'string', description: 'Идентификатор запроса' }
      }
    },
    handler: ({ projectId, requestId }) =>
      enqueueMutation(() => storage.deleteRequest(projectId, String(requestId)))
  },
  {
    name: 'set_active_environment',
    description: 'Выбрать активное окружение проекта (environmentId или null — без окружения).',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        environmentId: { type: ['string', 'null'], description: 'Идентификатор окружения или null' }
      }
    },
    handler: ({ projectId, environmentId }) =>
      enqueueMutation(() => storage.setActiveEnvironment(projectId, environmentId ?? null))
  },
  {
    name: 'send_request',
    description:
      'Отправить сохранённый запрос штатным движком приложения: {{переменные}} активного окружения подставляются в момент отправки. Тело ответа урезается до 100 КБ (поле truncated + actualSize).',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'requestId'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        requestId: { type: 'string', description: 'Идентификатор запроса' }
      }
    },
    handler: async ({ projectId, requestId }) => {
      const stored = (await storage.listRequests(projectId)).find((r) => r.id === String(requestId))
      if (!stored) throw new Error(`Запрос не найден: ${requestId}`)
      const snapshot = await resolveSnapshot(projectId, stored)
      return capBody(await sendRequest(snapshot, `mcp-${randomUUID()}`))
    }
  },
  {
    name: 'send_adhoc',
    description:
      'Отправить произвольный HTTP-запрос (без сохранения). Тело ответа урезается до 100 КБ (поле truncated + actualSize).',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        method: { type: 'string', description: 'HTTP-метод, по умолчанию GET' },
        url: { type: 'string', description: 'Полный URL (http/https)' },
        headers: { type: 'object', description: 'Заголовки картой {имя: значение}' },
        body: { type: 'string', description: 'Тело запроса как сырая строка' }
      }
    },
    handler: async (args) => capBody(await sendRequest(snapshotFromAdhoc(args), `mcp-${randomUUID()}`))
  },
  {
    name: 'import_curl',
    description: 'Разобрать строку curl в снимок запроса. Ничего не отправляет и не сохраняет.',
    inputSchema: {
      type: 'object',
      required: ['curl'],
      properties: { curl: { type: 'string', description: 'Команда curl' } }
    },
    handler: ({ curl }) => parseCurl(String(curl ?? ''))
  },
  {
    name: 'export_curl',
    description: 'Сгенерировать экранированную команду curl из сохранённого запроса.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'requestId'],
      properties: {
        projectId: { type: 'string', description: 'Идентификатор проекта' },
        requestId: { type: 'string', description: 'Идентификатор запроса' }
      }
    },
    handler: async ({ projectId, requestId }) => {
      const stored = (await storage.listRequests(projectId)).find((r) => r.id === String(requestId))
      if (!stored) throw new Error(`Запрос не найден: ${requestId}`)
      return generateCurl(stored)
    }
  }
]

// Последовательная очередь мутаций (design.md D9): два параллельных вызова не
// interleaved-нут read-modify-write одного файла проекта. Чтения идут без очереди.
let mutationChain = Promise.resolve()
function enqueueMutation(fn) {
  const run = mutationChain.then(fn, fn) // провал предыдущей не отменяет следующую
  mutationChain = run.then(() => {}, () => {})
  return run
}

// Результат инструмента — всегда успешный tool-result с JSON внутри (design.md D8):
// ошибки инструментов не рвут соединение с агентом.
async function runTool(handler, args) {
  try {
    const data = await handler(args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] }
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: err.code ?? 'ERROR', message: err.message } }) }]
    }
  }
}

// --- JSON-RPC 2.0 ---

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function dispatchRpc(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { status: 400, body: rpcError(null, RPC_ERRORS.INVALID_REQUEST, 'Некорректный JSON-RPC запрос') }
  }
  const isNotification = message.id === undefined || message.id === null

  switch (message.method) {
    case 'initialize': {
      // Согласование версий по спеке MCP (design.md D3): всегда отвечаем последней
      // поддерживаемой ревизией, даже если клиент просит более новую (например, 2025-11-25).
      // Отклонение ошибкой ломает реальные клиенты — они не понижают версию сами.
      // Наш поднабор (initialize/tools) между ревизиями стабилен.
      return {
        status: 200,
        body: rpcResult(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'request-lite', version: appVersion }
        })
      }
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return { status: 202, body: null } // уведомления подтверждаем пустым ответом
    case 'ping':
      return { status: 200, body: rpcResult(message.id, {}) }
    case 'tools/list':
      return {
        status: 200,
        body: rpcResult(message.id, { tools: TOOLS.map(({ handler, ...definition }) => definition) })
      }
    case 'tools/call': {
      const name = String(message.params?.name ?? '')
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) {
        return {
          status: 200,
          body: rpcResult(
            message.id,
            await runTool(async () => {
              throw new Error(`Неизвестный инструмент: ${name}`)
            })
          )
        }
      }
      return { status: 200, body: rpcResult(message.id, await runTool(tool.handler, message.params?.arguments)) }
    }
    default:
      if (isNotification) return { status: 202, body: null } // неизвестные уведомления игнорируем
      return { status: 404, body: rpcError(message.id, RPC_ERRORS.METHOD_NOT_FOUND, `Метод не найден: ${message.method}`) }
  }
}

// --- HTTP-транспорт (Streamable HTTP, только loopback и с токеном) ---

function isAuthorized(req) {
  if (!token) return false
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))
  if (!match) return false
  // constant-time сравнение, чтобы токен не вытекал через тайминги
  const provided = Buffer.from(match[1].trim(), 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

function readRpcBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > RPC_BODY_LIMIT) {
        reject(Object.assign(new Error('Тело запроса слишком большое'), { tooLarge: true }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleHttpRequest(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname
  if (req.method !== 'POST' || path !== '/mcp') {
    // GET /mcp (SSE-поток сервера) не поддерживаем — транспорт одно-ответный.
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Не найдено: используйте POST /mcp' }))
    return
  }
  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Требуется авторизация: Authorization: Bearer <токен>' }))
    return
  }

  let message
  try {
    message = JSON.parse(await readRpcBody(req))
  } catch (err) {
    if (err?.tooLarge) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Тело запроса слишком большое' }))
      return
    }
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rpcError(null, RPC_ERRORS.PARSE, 'Тело запроса не является валидным JSON')))
    return
  }

  try {
    const { status, body } = await dispatchRpc(message)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body === null ? '' : JSON.stringify(body))
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rpcError(message?.id ?? null, RPC_ERRORS.INTERNAL, err.message ?? 'Внутренняя ошибка')))
  }
}

// --- Жизненный цикл (design.md D5/D6) ---

function startListening(desiredPort) {
  return new Promise((resolve) => {
    const candidate = createServer((req, res) => {
      void handleHttpRequest(req, res)
    })
    candidate.once('error', (err) => {
      // Не роняем процесс: состояние «ошибка» уходит в UI, настройка порта сохраняется —
      // пользователь правит порт, рестарт происходит по applyMcpConfig.
      state = 'error'
      stateMessage = err.code === 'EADDRINUSE' ? `Порт ${desiredPort} занят другим процессом` : err.message
      server = null
      port = null
      resolve(getMcpStatus())
    })
    candidate.listen(desiredPort, '127.0.0.1', () => {
      server = candidate
      port = desiredPort
      state = 'running'
      stateMessage = ''
      resolve(getMcpStatus())
    })
  })
}

function stopListening() {
  return new Promise((resolve) => {
    const current = server
    server = null
    port = null
    state = 'stopped'
    stateMessage = ''
    if (!current) {
      resolve()
      return
    }
    current.close(() => resolve())
  })
}

// Единственная точка применения конфигурации: вызывается из index.js при старте
// и из IPC mcp:setConfig при изменениях (design.md D4). Смена порта/включения
// перезапускает слушателя, смена токена — нет.
export async function applyMcpConfig(settings) {
  const config = settings?.mcp ?? {}
  const enabled = config.enabled === true

  let desiredPort
  try {
    desiredPort = normalizePort(config.port ?? DEFAULT_PORT)
  } catch (err) {
    await stopListening()
    state = 'error'
    stateMessage = err.message
    return getMcpStatus()
  }

  // Токена нет (первое включение или перегенерация) — генерируем и сразу сохраняем.
  let desiredToken = typeof config.token === 'string' && config.token !== '' ? config.token : null
  if (enabled && !desiredToken) {
    desiredToken = randomBytes(32).toString('hex')
    await storage.setSettings({ mcp: { ...config, port: desiredPort, token: desiredToken } })
  }
  token = desiredToken

  if (!enabled) {
    if (server) await stopListening()
    else {
      state = 'stopped'
      stateMessage = ''
    }
    return getMcpStatus()
  }

  if (server && port === desiredPort) return getMcpStatus() // уже слушаем нужный порт
  await stopListening()
  return startListening(desiredPort)
}

export async function stopMcpServer() {
  await stopListening()
}
