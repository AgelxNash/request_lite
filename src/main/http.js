// Выполнение HTTP-запросов. Работает ТОЛЬКО в main-процессе — так снимается CORS:
// renderer не выполняет сетевых запросов, а присылает снимок запроса через IPC.
// Модуль не зависит от Electron — smoke-тесты (scripts/smoke.mjs) гоняют его в чистом Node.
import { randomUUID } from 'node:crypto'
// Agent и fetch из одного пакета: интерфейс Dispatcher у undici из node_modules
// несовместим с fetch, встроенным в Node (другая версия внутреннего undici).
// Пакетный путь используется ТОЛЬКО для https с выключенной проверкой сертификата:
// внутри Electron main его plain-HTTP ветка ненадёжна (см. e2e send-request).
import { Agent, fetch as undiciFetch } from 'undici'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024 // 10 МБ

// Ошибки с машинным кодом: IPC возвращает {ok: false, error: {code, message}}.
function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// Карты причин сетевых сбоев (err.cause.code у fetch failed) на машинные коды.
const SSL_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
])
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT'
])

// --- Сборка запроса из снимка вкладки ---

// Активные строки KV-таблицы: включённая галочка и непустой ключ.
function activeRows(rows) {
  return (rows ?? []).filter((row) => row.enabled !== false && String(row.key ?? '') !== '')
}

// Пользовательский заголовок с таким именем (без регистра) уже задан в снимке?
function userHasHeader(snapshot, name) {
  const lower = String(name).toLowerCase()
  return activeRows(snapshot?.headers).some((h) => String(h.key).toLowerCase() === lower)
}

// Тело form-data как multipart/form-data: текстовые пары, файлы не поддерживаются.
function buildMultipart(rows) {
  const boundary = `----postmanlite${randomUUID()}`
  const parts = []
  for (const row of activeRows(rows)) {
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${row.key}"\r\n` +
        `\r\n` +
        `${row.value ?? ''}\r\n`
    )
  }
  parts.push(`--${boundary}--\r\n`)
  return { boundary, body: parts.join('') }
}

// Строит {url, method, headers, body} из снимка вкладки.
// Auth и body конвертируются только здесь — «в момент отправки», не хранятся как заголовки.
export function buildRequest(snapshot) {
  const method = String(snapshot?.method ?? 'GET').toUpperCase()
  const urlRaw = String(snapshot?.url ?? '').trim()
  if (!urlRaw) throw codedError('INVALID_URL', 'URL запроса пуст')

  let url
  try {
    url = new URL(urlRaw)
  } catch {
    throw codedError('INVALID_URL', `Невалидный URL: ${urlRaw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw codedError('INVALID_URL', `Поддерживаются только http/https, получено: ${url.protocol}`)
  }

  const headers = []

  // 1. Query-параметры из таблицы Params (существующий query в URL сохраняется, дубликаты разрешены).
  for (const param of activeRows(snapshot.params)) {
    url.searchParams.append(param.key, param.value ?? '')
  }

  // 2. Авторизация.
  const auth = snapshot.auth ?? { type: 'none' }
  switch (auth.type) {
    case 'bearer':
      if (String(auth.token ?? '') !== '') {
        headers.push({ key: 'Authorization', value: `Bearer ${auth.token}` })
      }
      break
    case 'basic':
      headers.push({
        key: 'Authorization',
        value: 'Basic ' + Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`, 'utf8').toString('base64')
      })
      break
    case 'apikey': {
      const key = String(auth.key ?? '')
      if (key !== '') {
        if (auth.placement === 'query') url.searchParams.append(key, auth.value ?? '')
        else headers.push({ key, value: auth.value ?? '' })
      }
      break
    }
    default:
      break // none
  }

  // 3. Тело по выбранному типу (+ авто Content-Type, если пользователь не задал свой).
  const bodyObj = snapshot.body ?? { type: 'none' }
  let body
  let contentType = null
  switch (bodyObj.type) {
    case 'json':
      body = String(bodyObj.json ?? '')
      contentType = 'application/json'
      break
    case 'urlencoded':
      body = activeRows(bodyObj.urlencoded)
        .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value ?? '')}`)
        .join('&')
      contentType = 'application/x-www-form-urlencoded'
      break
    case 'form-data': {
      const multipart = buildMultipart(bodyObj.form)
      body = multipart.body
      contentType = `multipart/form-data; boundary=${multipart.boundary}`
      break
    }
    case 'text':
      body = String(bodyObj.text ?? '')
      contentType = 'text/plain'
      break
    default:
      body = undefined // none
  }
  if (contentType && !userHasHeader(snapshot, 'Content-Type')) {
    headers.push({ key: 'Content-Type', value: contentType })
  }

  // 4. Пользовательские заголовки (поверх авторских, без дедупликации).
  for (const header of activeRows(snapshot.headers)) {
    headers.push({ key: header.key, value: header.value ?? '' })
  }

  return { url: url.toString(), method, headers, body }
}

// --- Выполнение ---

// requestId → AbortController: отменить можно по id из другого IPC-вызова.
const controllers = new Map()

export function cancelRequest(requestId) {
  controllers.get(requestId)?.abort('cancel')
}

// Читает тело ответа, обрезая по лимиту (пометка truncated).
async function readBodyCapped(res, limit) {
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.length > limit) {
      const remaining = limit - total
      if (remaining > 0) chunks.push(value.subarray(0, remaining))
      truncated = true
      try {
        await reader.cancel()
      } catch {
        // поток уже закрыт — не важно
      }
      break
    }
    chunks.push(value)
    total += value.length
  }
  return { buffer: Buffer.concat(chunks), truncated }
}

export async function sendRequest(snapshot, requestId, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT
  const built = buildRequest(snapshot)

  const controller = new AbortController()
  controllers.set(requestId, controller)
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

  const init = {
    method: built.method,
    // fetch принимает пары [key, value], а не объекты {key, value} из buildRequest.
    headers: built.headers.map((h) => [h.key, h.value]),
    signal: controller.signal
  }
  // GET/HEAD не несут тела (fetch отклонит) — как в Postman, тело игнорируется.
  if (built.body !== undefined && built.method !== 'GET' && built.method !== 'HEAD') {
    init.body = built.body
  }
  // Выключенная проверка SSL касается только https: нужен undici-агент с
  // rejectUnauthorized: false (одноразовый, вместе со своим fetch из того же пакета).
  const isHttps = built.url.startsWith('https:')
  let agent = null
  let doFetch = fetch
  if (snapshot.sslVerify === false && isHttps) {
    agent = new Agent({ connect: { rejectUnauthorized: false } })
    init.dispatcher = agent
    doFetch = undiciFetch
    // AbortSignal из Electron main не проходит brand-check undici, поэтому сигнал
    // дублируем разрушением агента: сокет умирает — запрос прерывается гарантированно.
    controller.signal.addEventListener('abort', () => agent?.destroy(), { once: true })
  }

  const startedAt = performance.now()
  try {
    const res = await doFetch(built.url, init)
    const { buffer, truncated } = await readBodyCapped(res, bodyLimit)
    return {
      status: res.status,
      statusText: res.statusText,
      timeMs: Math.round(performance.now() - startedAt),
      size: buffer.byteLength,
      headers: [...res.headers.entries()].map(([key, value]) => ({ key, value })),
      body: new TextDecoder('utf-8', { fatal: false }).decode(buffer),
      truncated
    }
  } catch (err) {
    // Отмена/таймаут: надёжный признак — сам сигнал (Node может бросить и строку вместо Error
    // при abort до диспатча). Различаем по причине abort().
    if (controller.signal.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
      if (controller.signal.reason === 'timeout') {
        throw codedError('TIMEOUT', `Сервер не ответил за ${Math.round(timeoutMs / 1000)} с`)
      }
      throw codedError('ABORTED', 'Запрос отменён')
    }
    const cause = err.cause?.code
    if (cause && SSL_CODES.has(cause)) {
      throw codedError('SSL', `Ошибка SSL-сертификата (${cause}). Можно отключить проверку SSL в запросе.`)
    }
    if (cause && NETWORK_CODES.has(cause)) {
      throw codedError('NETWORK', `Ошибка сети (${cause}): ${err.cause.message ?? err.message}`)
    }
    throw codedError('NETWORK', `Ошибка запроса: ${err.cause?.message ?? err.message}`)
  } finally {
    clearTimeout(timer)
    controllers.delete(requestId)
    // Одноразовый агент: закрываем без ожидания, чтобы не держать keep-alive соединения.
    void agent?.close()
    agent = null
  }
}
