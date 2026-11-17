// Форматирование и подсветка JSON для ResponseView — без зависимостей.
// Модуль чистый (без Vue/Electron): smoke-тесты проверяют экранирование в Node.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch])
}

// Валидный JSON → отформатированная строка, иначе null (показываем сырой текст).
export function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

// Подсветка через v-html: каждый токен экранируется ДО вставки, поэтому XSS-строки безопасны.
export function highlightJson(text) {
  const source = String(text)
  // Строки (включая escape-последовательности), за ними ключ, булевы/null, числа.
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let out = ''
  let last = 0
  for (const match of source.matchAll(pattern)) {
    out += escapeHtml(source.slice(last, match.index))
    const token = escapeHtml(match[1] ?? match[0])
    if (match[2] !== undefined) {
      out += `<span class="tok-key">${token}</span>${escapeHtml(match[2])}`
    } else if (match[1] !== undefined) {
      out += `<span class="tok-string">${token}</span>`
    } else if (/^(true|false|null)$/.test(match[0])) {
      out += `<span class="tok-bool">${token}</span>`
    } else {
      out += `<span class="tok-number">${token}</span>`
    }
    last = match.index + match[0].length
  }
  out += escapeHtml(source.slice(last))
  return out
}
