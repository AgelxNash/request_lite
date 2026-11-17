// Дефолтное имя сохраняемого запроса из URL: последний непустой сегмент пути,
// иначе hostname. Невалидный/пустой URL → пустая строка (вызывающий код подставит свой fallback).
export function suggestRequestName(url) {
  try {
    const parsed = new URL(String(url ?? '').trim())
    const segments = parsed.pathname.split('/').filter(Boolean)
    return segments.at(-1) ?? parsed.hostname
  } catch {
    return ''
  }
}
