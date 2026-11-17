// Подстановка переменных окружения в момент отправки — чистый модуль без зависимостей
// (smoke-тесты импортируют его в Node, паттерн format.js).
// Неразрешённые плейсхолдеры остаются литерально; рекурсии нет — значения вставляются как есть.

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9._-]+)\s*\}\}/g

// Словарь включённых переменных: {ключ → значение}. Пустой ключ игнорируется.
export function buildVars(variables) {
  const map = {}
  for (const variable of variables ?? []) {
    if (variable?.enabled === false) continue
    const key = String(variable?.key ?? '')
    if (key === '') continue
    map[key] = String(variable?.value ?? '')
  }
  return map
}

function resolveText(text, vars) {
  return String(text ?? '').replace(PLACEHOLDER, (match, name) => vars[name] ?? match)
}

function resolveRows(rows, vars) {
  return (rows ?? []).map((row) => ({ ...row, key: resolveText(row.key, vars), value: resolveText(row.value, vars) }))
}

// Данные авторизации — тоже строковые поля запроса: их содержимое резолвится,
// конвертация в заголовок/query происходит позже в buildRequest (main).
function resolveAuth(auth, vars) {
  const source = auth ?? { type: 'none' }
  return {
    ...source,
    token: resolveText(source.token, vars),
    username: resolveText(source.username, vars),
    password: resolveText(source.password, vars),
    key: resolveText(source.key, vars),
    value: resolveText(source.value, vars)
  }
}

// Подставляет переменные во все строковые поля снимка запроса (мутирует копию полей).
// url, params (ключ+значение), headers (ключ+значение), auth (token/логин/пароль/ключ/значение),
// body (json/text, значения urlencoded/form-data).
export function applyEnvironment(snapshot, vars) {
  const body = snapshot.body ?? { type: 'none' }
  return {
    ...snapshot,
    url: resolveText(snapshot.url, vars),
    params: resolveRows(snapshot.params, vars),
    headers: resolveRows(snapshot.headers, vars),
    auth: resolveAuth(snapshot.auth, vars),
    body: {
      ...body,
      json: body.type === 'json' ? resolveText(body.json, vars) : body.json,
      text: body.type === 'text' ? resolveText(body.text, vars) : body.text,
      form: body.type === 'form-data' ? resolveRows(body.form, vars) : body.form,
      urlencoded: body.type === 'urlencoded' ? resolveRows(body.urlencoded, vars) : body.urlencoded
    }
  }
}
