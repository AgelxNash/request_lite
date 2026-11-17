// Локальный echo-сервер для ручного e2e.
// Запуск: node scripts/echo-server.mjs  →  http://localhost:4545
// GET /ping отвечает "pong", любой другой запрос — JSON-эхо (метод, путь, заголовки, тело).
import { createServer } from 'node:http'

const PORT = 4545

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')

    if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('pong')
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify(
        {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body === '' ? null : body
        },
        null,
        2
      )
    )
  })
})

server.listen(PORT, () => {
  console.log(`Echo-сервер запущен: http://localhost:${PORT}`)
  console.log('Примеры: curl http://localhost:4545/ping | curl -X POST -d \'{"a":1}\' http://localhost:4545/echo')
})
