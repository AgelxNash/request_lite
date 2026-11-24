// Генерация сниппетов кода из снимка запроса — чистый модуль без зависимостей
// (smoke-тесты гоняют его в Node). Работает на том же снимке, что и generateCurl,
// и делит с ним правила переноса URL и заголовков (buildUrlForExport, exportHeaders).
// Переменные {{var}} переносятся литерально: сниппет показывает запрос, а не значения окружения.

import { buildUrlForExport, exportHeaders } from './curl.js'

export const SNIPPET_LANGS = [
  { value: 'fetch', label: 'JavaScript Fetch' },
  { value: 'axios', label: 'JavaScript Axios' },
  { value: 'python', label: 'Python Requests' }
]

// Активные строки KV-таблицы: включённая галочка и непустой ключ (как их видит отправка).
function activeRows(rows) {
  return (rows ?? []).filter((row) => row.enabled !== false && String(row.key ?? '') !== '')
}

// Поле снимка с парами для составных тел: body.form (form-data) и body.urlencoded.
const ROWS_FIELD = { 'form-data': 'form', urlencoded: 'urlencoded' }

// Снимок → общие для всех языков части: метод, URL, заголовки, basic, тело.
function normalize(snapshot) {
  const method = String(snapshot.method ?? 'GET').toUpperCase()
  const bodyObj = snapshot.body ?? { type: 'none' }
  const bodyType = bodyObj.type ?? 'none'
  const carriesBody = method !== 'GET' && method !== 'HEAD' && bodyType !== 'none'
  const headers = exportHeaders(snapshot, { carriesBody })

  // urlencoded: явный Content-Type — как отправляет приложение. Curl его не ставит
  // (--data-urlencode), поэтому правило живёт здесь, а не в exportHeaders.
  const hasContentType = headers.some((h) => h.key.toLowerCase() === 'content-type')
  if (carriesBody && bodyType === 'urlencoded' && !hasContentType) {
    headers.unshift({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' })
  }

  const auth = snapshot.auth ?? { type: 'none' }
  const basic =
    auth.type === 'basic'
      ? { username: String(auth.username ?? ''), password: String(auth.password ?? '') }
      : null
  // Заголовок basic у fetch — на месте авторского, до пользовательских: при дубликате имени
  // побеждает последний, то есть пользовательский. Значение подставит fetch-генератор.
  if (basic) {
    headers.splice(headers.length - activeRows(snapshot.headers).length, 0, {
      key: 'Authorization',
      basic: true
    })
  }

  // Дубли имён (без учёта регистра) схлопываются: у литерала объекта/dict одно имя —
  // одно значение. cURL-экспорт дубликаты передаёт все (отдельные -H).
  const seen = new Set()
  const unique = []
  for (const header of [...headers].reverse()) {
    const name = header.key.toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)
    unique.push(header)
  }
  unique.reverse()

  const structured = carriesBody && (bodyType === 'urlencoded' || bodyType === 'form-data')
  const body = !carriesBody
    ? { type: 'none', text: '', rows: [] }
    : structured
      ? {
          type: bodyType,
          text: '',
          rows: activeRows(bodyObj[ROWS_FIELD[bodyType]]).map((row) => ({
            key: String(row.key),
            value: String(row.value ?? '')
          }))
        }
      : { type: bodyType, text: String(bodyObj[bodyType] ?? ''), rows: [] }

  return { method, url: buildUrlForExport(snapshot), headers: unique, basic, body }
}

// --- Рендеринг ---

// Строковый литерал, валидный и в JS, и в Python. База — JSON.stringify: корректные
// экранирования (\", \\, \n, управляющие как \u00XX), не-ASCII остаётся как есть.
// Если в значении нет одинарной кавычки — литерал в одинарных кавычках (\" разворачивается
// обратно): тело JSON читается как '{"name":"Ann"}', а не с обратными слешами на каждой кавычке.
function str(value) {
  const json = JSON.stringify(String(value ?? ''))
  return json.includes("'") ? json : `'${json.slice(1, -1).replace(/\\"/g, '"')}'`
}

// Блок {…} в столбик: по строке на элемент, запятые между ними. indent — отступ скобки,
// step — отступ элементов (2 для JS, 4 для Python).
function block(lines, indent, step) {
  const pad = ' '.repeat(indent)
  const inner = lines.map((line) => `${' '.repeat(indent + step)}${line}`)
  return `{\n${inner.join(',\n')}\n${pad}}`
}

// Строки «ключ: литерал» для заголовков без basic — axios и Python передают логин и пароль опцией.
function plainHeaderLines(headers) {
  return headers.filter((h) => !h.basic).map((h) => `${str(h.key)}: ${str(h.value)}`)
}

// Конструктор составного тела: urlencoded → URLSearchParams, form-data → FormData.
function structuredConstructor(type) {
  return type === 'urlencoded' ? 'URLSearchParams' : 'FormData'
}

// Base64 в UTF-8 без Buffer (renderer): так же считает main (Buffer.from(…, 'utf8')).
function base64Utf8(text) {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// Basic для fetch — заголовок Authorization. Без {{var}} значение считается здесь и совпадает
// с отправляемым приложением; с {{var}} его заранее не посчитать — btoa при выполнении сниппета.
function basicHeaderValue({ username, password }) {
  const credentials = `${username}:${password}`
  if (credentials.includes('{{')) return `'Basic ' + btoa(${str(credentials)})`
  return str(`Basic ${base64Utf8(credentials)}`)
}

function renderFetch({ method, url, headers, basic, body }) {
  const lines = []
  if (body.rows.length) {
    lines.push(`const body = new ${structuredConstructor(body.type)}();`)
    for (const row of body.rows) lines.push(`body.append(${str(row.key)}, ${str(row.value)});`)
    lines.push('')
  }

  const options = [`method: ${str(method)}`]
  // basic уходит заголовком; с {{var}} в учётных данных значение считается при выполнении.
  const headerLines = headers.map(
    (h) => `${str(h.key)}: ${h.basic ? basicHeaderValue(basic) : str(h.value)}`
  )
  if (headerLines.length) options.push(`headers: ${block(headerLines, 2, 2)}`)
  if (body.rows.length) options.push('body')
  else if (body.type !== 'none') options.push(`body: ${str(body.text)}`)

  lines.push(`const response = await fetch(${str(url)}, ${block(options, 0, 2)});`)
  return [...lines, '', 'console.log(response.status, await response.text());'].join('\n') + '\n'
}

function renderAxios({ method, url, headers, basic, body }) {
  const lines = ["import axios from 'axios';", '']
  if (body.rows.length) {
    lines.push(`const data = new ${structuredConstructor(body.type)}();`)
    for (const row of body.rows) lines.push(`data.append(${str(row.key)}, ${str(row.value)});`)
    lines.push('')
  }

  const options = [`method: ${str(method.toLowerCase())}`, `url: ${str(url)}`]
  const headerLines = plainHeaderLines(headers)
  if (headerLines.length) options.push(`headers: ${block(headerLines, 2, 2)}`)
  if (basic) {
    options.push(`auth: { username: ${str(basic.username)}, password: ${str(basic.password)} }`)
  }
  if (body.rows.length) options.push('data')
  else if (body.type !== 'none') options.push(`data: ${str(body.text)}`)

  lines.push(`const response = await axios(${block(options, 0, 2)});`)
  return [...lines, '', 'console.log(response.status, response.data);'].join('\n') + '\n'
}

// Методы, у которых requests имеет короткую форму; прочие идут через requests.request.
const PYTHON_SHORTHANDS = new Set(['get', 'options', 'head', 'post', 'put', 'patch', 'delete'])

function renderPython({ method, url, headers, basic, body }) {
  const lines = ['import requests', '', `url = ${str(url)}`]
  const headerLines = plainHeaderLines(headers)
  if (headerLines.length) lines.push('', `headers = ${block(headerLines, 0, 4)}`)

  const args = ['url']
  if (headerLines.length) args.push('headers=headers')
  if (body.type === 'urlencoded') {
    const pairs = body.rows.map((row) => `${str(row.key)}: ${str(row.value)}`)
    args.push(`data={${pairs.join(', ')}}`)
  } else if (body.type === 'form-data') {
    // Текстовое поле multipart без имени файла: requests отправляет его парой (None, значение).
    const fields = body.rows.map((row) => `${str(row.key)}: (None, ${str(row.value)})`)
    args.push(`files={${fields.join(', ')}}`)
  } else if (body.type !== 'none') {
    args.push(`data=${str(body.text)}`)
  }
  if (basic) args.push(`auth=(${str(basic.username)}, ${str(basic.password)})`)

  const shorthand = method.toLowerCase()
  const hasShorthand = PYTHON_SHORTHANDS.has(shorthand)
  const call = hasShorthand ? `requests.${shorthand}` : 'requests.request'
  // У requests.request первым аргументом идёт метод: requests.request('PROPFIND', url, …).
  const methodArg = hasShorthand ? '' : `${str(method)}, `
  lines.push('', `response = ${call}(${methodArg}${args.join(', ')})`)

  return [...lines, '', 'print(response.status_code, response.text)'].join('\n') + '\n'
}

const RENDERERS = { fetch: renderFetch, axios: renderAxios, python: renderPython }

// Сниппет из снимка. Значения экранируются; {{var}} остаётся литерально.
// Бросает Error с именем языка, если он неизвестен.
export function generateSnippet(snapshot, lang) {
  if (!Object.hasOwn(RENDERERS, lang)) throw new Error(`Неизвестный язык сниппета: ${lang}`)
  return RENDERERS[lang](normalize(snapshot ?? {}))
}
