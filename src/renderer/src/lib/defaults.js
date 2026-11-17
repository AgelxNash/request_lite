// Стандартные заголовки новой вкладки — чистый модуль без зависимостей
// (smoke-тесты импортируют его в Node, паттерн format.js).
// Включённый заголовок заменяет автозначение undici (дублирования нет),
// снятая галочка — строка не отправляется, возвращается автозначение клиента.
export const DEFAULT_HEADERS = [
  { key: 'User-Agent', value: 'PostmanLite/1.0', enabled: true },
  { key: 'Accept', value: 'application/json', enabled: true },
  { key: 'Accept-Language', value: 'ru-RU,ru;q=0.9', enabled: true }
]
