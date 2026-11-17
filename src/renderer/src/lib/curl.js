// Конвертация запрос ↔ curl — чистый модуль без зависимостей (smoke-тесты гоняют в Node).
// Парсер: shell-токенизация + флаги curl. Генератор: одинарные кавычки с экранированием.
// Переменные {{var}} переносятся литерально в обе стороны.

let nextRowId = 1

function makeRow(key, value) {
  return { id: `curl-row-${nextRowId++}`, key, value, enabled: true }
}

function makeHeader(key, value) {
  return makeRow(key, value)
}

// --- Токенизация (POSIX shell, упрощённо: без $-раскрытий) ---

export function tokenizeShell(text) {
  const tokens = []
  let current = ''
  let hasToken = false
  let mode = 'normal' // normal | single | double

  const push = () => {
    if (hasToken) tokens.push(current)
    current = ''
    hasToken = false
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (mode === 'single') {
      if (char === "'") {
        mode = 'normal'
      } else {
        current += char
        hasToken = true
      }
      continue
    }

    if (mode === 'double') {
      if (char === '\\' && next === '"') {
        current += '"'
        i += 1
      } else if (char === '\\' && next === '\\') {
        current += '\\'
        i += 1
      } else if (char === '\\' && (next === '\n' || next === '\r\n')) {
        // В двойных кавычках bash убирает \<перевод строки> — продолжение команды.
        if (next === '\r\n') i += 1
        i += 1
      } else if (char === '"') {
        mode = 'normal'
      } else {
        current += char
        hasToken = true
      }
      continue
    }

    // normal
    if (char === "'") {
      mode = 'single'
      hasToken = true
      continue
    }
    if (char === '"') {
      mode = 'double'
      hasToken = true
      continue
    }
    if (char === '\\') {
      if (next === '\n' || next === '\r\n') {
        if (next === '\r\n') i += 1
        i += 1
        push() // продолжение: текущий токен завершён
        continue
      }
      if (next !== undefined) {
        current += next
        hasToken = true
        i += 1
        continue
      }
      continue // \ в самом конце — отбрасывается
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      push()
      continue
    }
    current += char
    hasToken = true
  }
  push()
  return tokens
}

// --- Парсер ---

const VALUE_FLAGS = new Set([
  '-x', '--request',
  '-h', '--header',
  '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode',
  '-f', '--form',
  '-u', '--user',
  '-b', '--cookie',
  '--url',
  '--json'
])
const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'])
const HEADER_SPLIT = /^([^:]+):(?:\s*)(.*)$/

// Парсит команду curl в снимок запроса. Бросает Error с понятным сообщением.
export function parseCurl(text) {
  const tokens = tokenizeShell(String(text ?? ''))
  // Ведущий curl (включая полный путь) отбрасываем.
  if (tokens.length && /(^|\/)curl(\.exe)?$/i.test(tokens[0])) tokens.shift()

  let method = null
  let url = null
  const headerPairs = []
  const dataParts = []
  const urlencodedParts = []
  const formPairs = []
  let isGetFlag = false
  let user = null
  let cookie = null
  let isJsonFlag = false

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token.startsWith('-')) {
      if (url === null && /^https?:\/\//i.test(token)) url = token
      continue
    }

    let name = token
    let attached = null
    const eqIndex = token.indexOf('=')
    if (token.startsWith('--') && eqIndex > 2) {
      name = token.slice(0, eqIndex)
      attached = token.slice(eqIndex + 1)
    } else if (token.startsWith('-') && !token.startsWith('--') && token.length > 2) {
      // Слитная короткая форма: -XPOST, -Hfoo
      const letter = token.slice(0, 2).toLowerCase()
      if (VALUE_FLAGS.has(letter)) {
        name = token.slice(0, 2)
        attached = token.slice(2)
      }
    }

    const flag = name.toLowerCase()
    const takeValue = () => {
      if (attached !== null) return attached
      const next = tokens[i + 1]
      if (next === undefined) throw new Error(`Флаг ${name} ожидает значение`)
      i += 1
      return next
    }

    if (VALUE_FLAGS.has(flag)) {
      const value = takeValue()
      switch (flag) {
        case '-x':
        case '--request':
          method = String(value).toUpperCase()
          break
        case '-h':
        case '--header': {
          const match = HEADER_SPLIT.exec(String(value))
          if (match) headerPairs.push([match[1].trim(), match[2]])
          break
        }
        case '-d':
        case '--data':
        case '--data-raw':
        case '--data-binary':
        case '--data-ascii':
          dataParts.push(String(value))
          break
        case '--data-urlencode':
          // curl сам закодирует пару при отправке; сохраняем как urlencoded-пару.
          urlencodedParts.push(String(value))
          break
        case '-f':
        case '--form': {
          const pair = String(value)
          const eq = pair.indexOf('=')
          if (eq !== -1) formPairs.push([pair.slice(0, eq), pair.slice(eq + 1)])
          break
        }
        case '-u':
        case '--user':
          user = String(value)
          break
        case '-b':
        case '--cookie':
          cookie = String(value)
          break
        case '--url':
          url = String(value)
          break
        case '--json':
          isJsonFlag = true
          dataParts.push(String(value))
          break
        default:
          break
      }
      continue
    }

    if (flag === '-g' || flag === '--get') isGetFlag = true
    // Неизвестные флаги (в т.ч. без значений) пропускаются — толерантность curl.
  }

  if (!url) throw new Error('В команде не найден URL (ожидается http/https)')

  const headers = headerPairs.map(([key, value]) => makeHeader(key, value))
  if (cookie !== null) headers.push(makeHeader('Cookie', cookie))

  // Content-Type по семантике curl: --json → application/json; -d без явного — x-www-form-urlencoded.
  const hasContentType = headers.some((h) => h.key.toLowerCase() === 'content-type')
  if (isJsonFlag && !hasContentType) headers.push(makeHeader('Content-Type', 'application/json'))

  const auth = user !== null
    ? (() => {
        const sep = user.indexOf(':')
        return {
          type: 'basic',
          username: sep === -1 ? user : user.slice(0, sep),
          password: sep === -1 ? '' : user.slice(sep + 1)
        }
      })()
    : { type: 'none' }

  const params = []
  let body
  const hasBodyData = dataParts.length || urlencodedParts.length || formPairs.length
  if (isGetFlag && dataParts.length) {
    // -G: части -d раскладываются в query-параметры.
    for (const part of dataParts) {
      for (const pair of String(part).split('&')) {
        if (pair === '') continue
        const eq = pair.indexOf('=')
        params.push(makeRow(eq === -1 ? pair : pair.slice(0, eq), eq === -1 ? '' : pair.slice(eq + 1)))
      }
    }
    body = { type: 'none', json: '', form: [], urlencoded: [], text: '' }
  } else if (formPairs.length) {
    body = { type: 'form-data', json: '', form: formPairs.map(([k, v]) => makeRow(k, v)), urlencoded: [], text: '' }
  } else if (urlencodedParts.length) {
    // --data-urlencode: пары k=v (curl закодирует при отправке).
    const urlencoded = urlencodedParts.map((part) => {
      const eq = part.indexOf('=')
      return makeRow(eq === -1 ? part : part.slice(0, eq), eq === -1 ? '' : part.slice(eq + 1))
    })
    body = { type: 'urlencoded', json: '', form: [], urlencoded, text: '' }
    if (!hasContentType) headers.push(makeHeader('Content-Type', 'application/x-www-form-urlencoded'))
  } else if (dataParts.length) {
    const isJsonBody =
      isJsonFlag ||
      headers.some(
        (h) => h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().includes('json')
      )
    if (isJsonBody) {
      body = { type: 'json', json: dataParts.join(''), form: [], urlencoded: [], text: '' }
    } else {
      body = { type: 'text', json: '', form: [], urlencoded: [], text: dataParts.join('') }
      if (!hasContentType) headers.push(makeHeader('Content-Type', 'application/x-www-form-urlencoded'))
    }
  } else {
    body = { type: 'none', json: '', form: [], urlencoded: [], text: '' }
  }

  const resolvedMethod = method ?? (isGetFlag ? 'GET' : hasBodyData ? 'POST' : 'GET')

  return {
    name: '',
    method: resolvedMethod.toUpperCase(),
    url,
    params,
    headers,
    body,
    auth,
    sslVerify: true
  }
}

// --- Генератор ---

// Значение в одинарных кавычках: ' → '\''
function q(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

// Строит URL с query-параметрами (params и apikey в query) без их потери.
// Шаблонный URL с {{var}} — не валидный URL для new URL: добавляем пары строкой.
function buildUrlForExport(snapshot) {
  const queryRows = []
  for (const row of snapshot.params ?? []) {
    if (row.enabled === false || String(row.key ?? '') === '') continue
    queryRows.push([row.key, row.value ?? ''])
  }
  const auth = snapshot.auth ?? { type: 'none' }
  if (auth.type === 'apikey' && auth.placement === 'query' && String(auth.key ?? '') !== '') {
    queryRows.push([auth.key, auth.value ?? ''])
  }
  if (!queryRows.length) return String(snapshot.url)

  try {
    const url = new URL(snapshot.url)
    for (const [key, value] of queryRows) url.searchParams.append(key, value)
    return url.toString()
  } catch {
    const separator = String(snapshot.url).includes('?') ? '&' : '?'
    const query = queryRows.map(([k, v]) => `${k}=${v}`).join('&')
    return `${snapshot.url}${separator}${query}`
  }
}

// Команда curl из снимка. Значения экранируются; {{var}} остаётся литерально.
export function generateCurl(snapshot) {
  const url = buildUrlForExport(snapshot)
  const parts = ['curl', q(url)]

  const method = String(snapshot.method ?? 'GET').toUpperCase()
  if (method !== 'GET') parts.push('-X', method)

  const auth = snapshot.auth ?? { type: 'none' }
  if (auth.type === 'basic') {
    parts.push('-u', q(`${auth.username ?? ''}:${auth.password ?? ''}`))
  }

  const headers = (snapshot.headers ?? []).filter((h) => h.enabled !== false && String(h.key ?? '') !== '')
  const userHasContentType = headers.some((h) => h.key.toLowerCase() === 'content-type')

  const body = snapshot.body ?? { type: 'none' }
  const bodyType = body.type ?? 'none'
  const carriesBody = method !== 'GET' && method !== 'HEAD' && bodyType !== 'none'

  if (carriesBody && bodyType === 'json' && !userHasContentType) {
    parts.push('-H', q('Content-Type: application/json'))
  }
  if (carriesBody && bodyType === 'text' && !userHasContentType) {
    parts.push('-H', q('Content-Type: text/plain'))
  }

  if (auth.type === 'bearer' && String(auth.token ?? '') !== '') {
    parts.push('-H', q(`Authorization: Bearer ${auth.token}`))
  }
  if (auth.type === 'apikey' && auth.placement !== 'query' && String(auth.key ?? '') !== '') {
    parts.push('-H', q(`${auth.key}: ${auth.value ?? ''}`))
  }

  for (const header of headers) {
    parts.push('-H', q(`${header.key}: ${header.value ?? ''}`))
  }

  if (carriesBody) {
    if (bodyType === 'urlencoded') {
      for (const row of body.urlencoded ?? []) {
        if (row.enabled === false || String(row.key ?? '') === '') continue
        parts.push('--data-urlencode', q(`${row.key}=${row.value ?? ''}`))
      }
    } else if (bodyType === 'form-data') {
      for (const row of body.form ?? []) {
        if (row.enabled === false || String(row.key ?? '') === '') continue
        parts.push('-F', q(`${row.key}=${row.value ?? ''}`))
      }
    } else if (bodyType === 'json') {
      parts.push('-d', q(body.json ?? ''))
    } else if (bodyType === 'text') {
      parts.push('-d', q(body.text ?? ''))
    }
  }

  return parts.join(' ')
}
