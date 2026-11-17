// Импорт коллекции Postman v2.x — чистый модуль без зависимостей (smoke в Node).
// parseCollection(text) → {name, requests[], variables[]} в форме записей хранилища:
// папки → префиксы «Folder / Req», raw(+lang:json) → json, urlencoded/formdata → таблицы,
// файл-поля formdata → литерал @src, file/graphql → none, auth запроса с наследованием
// от коллекции, collection.variable → variables. Переменные {{var}} не затрагиваются.

let nextId = 1

function makeRow(key, value, disabled) {
  return { id: `pm-row-${nextId++}`, key: String(key ?? ''), value: String(value ?? ''), enabled: !disabled }
}

function makeHeader(key, value, disabled) {
  return makeRow(key, value, disabled)
}

// --- Авторизация: форма Postman (массив пар key/value) → модель приложения ---

function authValue(pairs, key) {
  const item = (pairs ?? []).find((p) => p?.key === key)
  return String(item?.value ?? '')
}

function normalizeAuth(auth) {
  if (!auth || typeof auth !== 'object' || !auth.type) return null
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: authValue(auth.bearer, 'token') }
    case 'basic':
      return {
        type: 'basic',
        username: authValue(auth.basic, 'username'),
        password: authValue(auth.basic, 'password')
      }
    case 'apikey':
      return {
        type: 'apikey',
        key: authValue(auth.apikey, 'key'),
        value: authValue(auth.apikey, 'value'),
        placement: authValue(auth.apikey, 'in') === 'query' ? 'query' : 'header'
      }
    default:
      return null // digest, oauth1/2, hawk и пр. — не переносим
  }
}

const AUTH_NONE = { type: 'none' }

function normalizeBody(body) {
  if (!body || typeof body !== 'object' || !body.mode) {
    return { type: 'none', json: '', form: [], urlencoded: [], text: '' }
  }
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.lang
      if (lang === 'json') return { type: 'json', json: String(body.raw ?? ''), form: [], urlencoded: [], text: '' }
      return { type: 'text', json: '', form: [], urlencoded: [], text: String(body.raw ?? '') }
    }
    case 'urlencoded':
      return {
        type: 'urlencoded',
        json: '',
        form: [],
        text: '',
        urlencoded: (body.urlencoded ?? []).map((item) => makeRow(item.key, item.value, item.disabled))
      }
    case 'formdata':
      return {
        type: 'form-data',
        json: '',
        urlencoded: [],
        text: '',
        form: (body.formdata ?? []).map((item) => {
          // файл-поля: значение литералом @src (src может быть массивом — берём первый)
          if (item.type === 'file') {
            const src = Array.isArray(item.src) ? item.src[0] : item.src
            return makeRow(item.key, `@${src ?? ''}`)
          }
          const value = typeof item.value === 'object' ? (item.value?.value ?? '') : (item.value ?? '')
          return makeRow(item.key, value, item.disabled)
        })
      }
    default:
      return { type: 'none', json: '', form: [], urlencoded: [], text: '' } // file, graphql
  }
}

function normalizeRequest(item, prefix) {
  const request = item.request ?? {}
  const method = String(request.method ?? 'GET').toUpperCase()

  // URL: строка или объект {raw, query[]}
  let url = ''
  let params = []
  const rawUrl = request.url
  if (typeof rawUrl === 'string') {
    url = rawUrl
  } else if (rawUrl && typeof rawUrl === 'object') {
    url = String(rawUrl.raw ?? '')
    params = (rawUrl.query ?? []).map((q) => makeRow(q.key, q.value, q.disabled))
  }

  const headers = (request.header ?? []).map((h) => makeHeader(h.key, h.value, h.disabled))
  const body = normalizeBody(request.body)
  const auth = normalizeAuth(request.auth) // null → наследование от коллекции

  const name = String(item.name ?? '').trim() || 'Imported Request'
  const fullName = prefix ? `${prefix} / ${name}` : name

  return {
    id: `pm-req-${nextId++}`,
    name: fullName,
    method,
    url,
    params,
    headers,
    body,
    auth,
    sslVerify: true,
    locked: false
  }
}

// Рекурсивный обход item-дерева: папки (item[] внутри item) накапливают префикс.
function walkItems(items, prefix, out, collectionAuth) {
  for (const item of items ?? []) {
    if (!item || typeof item !== 'object') continue
    if (Array.isArray(item.item)) {
      const nextPrefix = prefix ? `${prefix} / ${String(item.name ?? '')}` : String(item.name ?? '')
      walkItems(item.item, nextPrefix, out, collectionAuth)
      continue
    }
    if (item.request) {
      const record = normalizeRequest(item, prefix)
      // Наследование: запрос без собственной авторизации получает авторизацию коллекции.
      record.auth = record.auth ?? collectionAuth ?? AUTH_NONE
      out.push(record)
    }
  }
}

// Разбор коллекции Postman v2.x. Бросает Error с понятным сообщением.
export function parseCollection(text) {
  let collection
  try {
    collection = JSON.parse(String(text ?? ''))
  } catch (err) {
    throw new Error(`Файл не является корректным JSON: ${err.message}`)
  }
  if (
    !collection ||
    typeof collection !== 'object' ||
    typeof collection.info?.name !== 'string' ||
    !collection.info.name.trim() ||
    !Array.isArray(collection.item)
  ) {
    throw new Error('Не похоже на коллекцию Postman v2.x (нет info.name или item)')
  }

  const collectionAuth = normalizeAuth(collection.auth)
  const requests = []
  walkItems(collection.item, '', requests, collectionAuth)

  const variables = (collection.variable ?? []).map((v) =>
    makeRow(v?.key, v?.value, v?.disabled === true)
  )

  return {
    name: collection.info.name.trim(),
    requests,
    variables
  }
}
