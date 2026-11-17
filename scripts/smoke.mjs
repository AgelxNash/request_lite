// Смоук-тесты: чистый Node, без Electron — хранилище, сборка/выполнение запросов, формат JSON.
// Запуск: node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const storage = await import('../src/main/storage.js')
const http = await import('../src/main/http.js')
const format = await import('../src/renderer/src/lib/format.js')
const defaults = await import('../src/renderer/src/lib/defaults.js')
const requestName = await import('../src/renderer/src/lib/request-name.js')
const variables = await import('../src/renderer/src/lib/variables.js')

let passed = 0

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`  ok — ${name}`)
    })
}

const root = await mkdtemp(join(tmpdir(), 'postman-lite-smoke-'))

try {
  // --- Проекты: create → list ---
  await storage.initStorage(root)
  await storage.bootstrap()

  await check('createProject создаёт проект и возвращает структуру', async () => {
    const project = await storage.createProject('Alpha')
    assert.equal(project.name, 'Alpha')
    assert.ok(project.id)
    assert.ok(project.createdAt)
    assert.ok(project.updatedAt)
  })

  await check('второй проект с тем же именем существует как отдельная запись', async () => {
    await storage.createProject('Alpha') // то же имя — отдельный проект
    const projects = await storage.listProjects()
    assert.equal(projects.length, 2)
    assert.notEqual(projects[0].id, projects[1].id)
  })

  await check('createProject отклоняет пустое имя', async () => {
    await assert.rejects(() => storage.createProject('   '), /пустым/)
  })

  // --- Структура файлов ---
  await check('на диске: projects.json + projects/<id>.json с дефолтным содержимым', async () => {
    const index = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
    assert.equal(index.length, 2)
    const projectFile = JSON.parse(await readFile(join(root, 'projects', `${index[0].id}.json`), 'utf8'))
    assert.deepEqual(projectFile, { requests: [], environments: [], activeEnvId: null })
  })

  await check('после записи не остаётся .tmp файлов (атомарность)', async () => {
    const files = await readdir(root)
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0)
  })

  // --- rename ---
  await check('renameProject меняет имя в индексе, данные проекта сохраняются', async () => {
    const [first] = await storage.listProjects()
    const updated = await storage.renameProject(first.id, 'Alpha-2')
    assert.equal(updated.name, 'Alpha-2')
    const index = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'))
    assert.equal(index.find((p) => p.id === first.id).name, 'Alpha-2')
    const projectFile = JSON.parse(await readFile(join(root, 'projects', `${first.id}.json`), 'utf8'))
    assert.deepEqual(projectFile, { requests: [], environments: [], activeEnvId: null })
  })

  await check('renameProject неизвестного id отклоняется', async () => {
    await assert.rejects(() => storage.renameProject('no-such-id', 'X'), /не найден/)
  })

  // --- Персистентность: переинициализация на той же папке ---
  await check('после переинициализации проекты читаются с диска (persist)', async () => {
    const storage2 = await import('../src/main/storage.js')
    const fresh = join(root) // та же папка; имитируем новый запуск: новая инициализация кэша
    storage2.initStorage(fresh)
    await storage2.bootstrap()
    const projects = await storage2.listProjects()
    assert.equal(projects.length, 2)
    assert.ok(projects.some((p) => p.name === 'Alpha-2'))
  })

  // --- delete ---
  await check('deleteProject убирает запись из индекса и файл проекта', async () => {
    const projects = await storage.listProjects()
    const victim = projects[1]
    await storage.deleteProject(victim.id)
    const rest = await storage.listProjects()
    assert.equal(rest.length, 1)
    await assert.rejects(() => readFile(join(root, 'projects', `${victim.id}.json`), 'utf8'), /ENOENT/)
  })

  await check('deleteProject неизвестного id отклоняется', async () => {
    await assert.rejects(() => storage.deleteProject('no-such-id'), /не найден/)
  })

  // --- Запросы проекта: save/list/delete ---
  const requestsProject = await storage.createProject('Хранилище запросов')
  const fullRequest = {
    id: 'req-1',
    name: 'Users',
    method: 'POST',
    url: 'https://api.example.com/users',
    params: [{ id: 'p1', key: 'page', value: '2', enabled: true }],
    headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
    body: { type: 'json', json: '{"limit":5}' },
    auth: { type: 'bearer', token: 't-123' },
    sslVerify: false
  }

  await check('saveRequest добавляет запрос в requests[] и пишет на диск', async () => {
    const list = await storage.saveRequest(requestsProject.id, fullRequest)
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'Users')
    const onDisk = await storage.getProject(requestsProject.id)
    assert.equal(onDisk.requests.length, 1)
    assert.equal(onDisk.requests[0].body.json, '{"limit":5}')
    assert.equal(onDisk.requests[0].sslVerify, false)
  })

  await check('saveRequest с тем же id обновляет запись на её позиции (upsert)', async () => {
    await storage.saveRequest(requestsProject.id, { id: 'req-2', name: 'Token' })
    const list = await storage.saveRequest(requestsProject.id, {
      ...fullRequest,
      name: 'Users v2',
      url: 'https://api.example.com/v2'
    })
    assert.equal(list.length, 2)
    assert.equal(list[0].name, 'Users v2', 'позиция сохранена')
    assert.equal(list[0].url, 'https://api.example.com/v2')
    assert.equal(list[1].name, 'Token')
  })

  await check('saveRequest отклоняет пустое имя и запрос без id', async () => {
    await assert.rejects(() => storage.saveRequest(requestsProject.id, { id: 'req-3', name: '   ' }), /пустым/)
    await assert.rejects(() => storage.saveRequest(requestsProject.id, { name: 'NoId' }), /должен быть id/)
  })

  await check('deleteRequest убирает запрос, остальные остаются; неизвестный id отклоняется', async () => {
    const list = await storage.deleteRequest(requestsProject.id, 'req-1')
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'req-2')
    await assert.rejects(() => storage.deleteRequest(requestsProject.id, 'req-1'), /не найден/)
    const onDisk = await storage.getProject(requestsProject.id)
    assert.equal(onDisk.requests.length, 1)
  })

  // --- Окружения проекта: save/list/setActive/delete ---
  const envProject = await storage.createProject('Хранилище окружений')

  await check('saveEnvironment upsert: добавление, обновление на позиции, пустое имя', async () => {
    await storage.saveEnvironment(envProject.id, {
      id: 'env-1',
      name: 'Dev',
      variables: [{ id: 'v1', key: 'baseUrl', value: 'http://localhost', enabled: true }]
    })
    await storage.saveEnvironment(envProject.id, { id: 'env-2', name: 'Prod', variables: [] })
    const list = await storage.saveEnvironment(envProject.id, { id: 'env-1', name: 'Dev v2' })
    assert.equal(list.length, 2)
    assert.equal(list[0].name, 'Dev v2', 'позиция сохранена')
    assert.equal(list[1].name, 'Prod')
    await assert.rejects(() => storage.saveEnvironment(envProject.id, { id: 'env-3', name: '  ' }), /пустым/)
  })

  await check('setActiveEnvironment персистентен и отклоняет неизвестный id', async () => {
    const { activeEnvId } = await storage.setActiveEnvironment(envProject.id, 'env-1')
    assert.equal(activeEnvId, 'env-1')
    const onDisk = await storage.getProject(envProject.id)
    assert.equal(onDisk.activeEnvId, 'env-1')
    await assert.rejects(() => storage.setActiveEnvironment(envProject.id, 'nope'), /не найден/)
  })

  await check('deleteEnvironment обнуляет activeEnvId удалённого активного', async () => {
    const { activeEnvId, environments } = await storage.deleteEnvironment(envProject.id, 'env-1')
    assert.equal(environments.length, 1)
    assert.equal(activeEnvId, null)
    await assert.rejects(() => storage.deleteEnvironment(envProject.id, 'env-1'), /не найден/)
  })

  // --- Невалидный JSON не затирается ---
  await check('повреждённый projects.json вызывает CORRUPT_STORAGE и не перезаписывается', async () => {
    const garbage = '{ это не json'
    await writeFile(join(root, 'projects.json'), garbage, 'utf8')
    await assert.rejects(
      () => storage.listProjects(),
      (err) => err.code === 'CORRUPT_STORAGE'
    )
    const after = await readFile(join(root, 'projects.json'), 'utf8')
    assert.equal(after, garbage, 'файл не должен быть перезаписан')
  })

  // --- Настройки ---
  await check('getSettings по умолчанию возвращает тёмную тему', async () => {
    const settings = await storage.getSettings()
    assert.deepEqual(settings, { theme: 'dark' })
  })

  await check('setSettings сохраняет тему и другие ключи не теряются', async () => {
    await storage.setSettings({ theme: 'light' })
    await storage.setSettings({ futureSetting: 42 })
    const settings = await storage.getSettings()
    assert.deepEqual(settings, { theme: 'light', futureSetting: 42 })
    const onDisk = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))
    assert.equal(onDisk.theme, 'light')
  })

  await check('getSettingsSync (для preload) отдаёт актуальный кэш', () => {
    assert.deepEqual(storage.getSettingsSync(), { theme: 'light', futureSetting: 42 })
  })

  // --- HTTP: сборка запроса (buildRequest) ---

  await check('buildRequest мержит включённые params в query и сохраняет query из URL', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com/users?limit=10',
      params: [
        { id: '1', key: 'page', value: '2', enabled: true },
        { id: '2', key: 'limit', value: '99', enabled: true }
      ]
    })
    assert.equal(built.url, 'https://api.example.com/users?limit=10&page=2&limit=99')
    assert.equal(built.method, 'GET')
    assert.equal(built.body, undefined)
  })

  await check('buildRequest пропускает отключённые строки и строки с пустым ключом', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      params: [
        { id: '1', key: 'debug', value: '1', enabled: false },
        { id: '2', key: '', value: 'x', enabled: true },
        { id: '3', key: 'ok', value: 'yes', enabled: true }
      ],
      headers: [
        { id: '4', key: 'X-Trace', value: 'abc', enabled: false },
        { id: '5', key: 'X-Real', value: 'yes', enabled: true }
      ]
    })
    assert.ok(!built.url.includes('debug'), 'отключённый param не попадает в URL')
    assert.ok(built.url.endsWith('ok=yes'))
    assert.deepEqual(built.headers, [{ key: 'X-Real', value: 'yes' }])
  })

  await check('buildRequest отклоняет пустой и невалидный URL кодом INVALID_URL', () => {
    assert.throws(() => http.buildRequest({ method: 'GET', url: '' }), (err) => err.code === 'INVALID_URL')
    assert.throws(() => http.buildRequest({ method: 'GET', url: 'not a url' }), (err) => err.code === 'INVALID_URL')
    assert.throws(() => http.buildRequest({ method: 'GET', url: 'ftp://example.com' }), (err) => err.code === 'INVALID_URL')
  })

  await check('buildRequest: bearer → Authorization: Bearer <token>', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: 't-secret-123' }
    })
    assert.deepEqual(built.headers, [{ key: 'Authorization', value: 'Bearer t-secret-123' }])
  })

  await check('buildRequest: bearer с пустым токеном не добавляет заголовок', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'bearer', token: '' }
    })
    assert.deepEqual(built.headers, [])
  })

  await check('buildRequest: basic → Authorization: Basic <base64>, unicode через Buffer', () => {
    const built = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: 'user', password: 'pass' }
    })
    assert.equal(built.headers[0].value, 'Basic dXNlcjpwYXNz')
    const unicode = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'basic', username: 'user', password: 'пароль' }
    })
    assert.equal(unicode.headers[0].value, 'Basic ' + Buffer.from('user:пароль', 'utf8').toString('base64'))
  })

  await check('buildRequest: apikey в заголовок и в query по placement', () => {
    const asHeader = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'apikey', key: 'X-Api-Key', value: 'k-42', placement: 'header' }
    })
    assert.deepEqual(asHeader.headers, [{ key: 'X-Api-Key', value: 'k-42' }])

    const asQuery = http.buildRequest({
      method: 'GET',
      url: 'https://api.example.com',
      auth: { type: 'apikey', key: 'apiKey', value: 'k-42', placement: 'query' }
    })
    assert.equal(asQuery.url, 'https://api.example.com/?apiKey=k-42')
    assert.deepEqual(asQuery.headers, [])
  })

  await check('buildRequest: тело json с Content-Type application/json', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: { type: 'json', json: '{"name":"Ann"}' }
    })
    assert.equal(built.body, '{"name":"Ann"}')
    assert.deepEqual(built.headers, [{ key: 'Content-Type', value: 'application/json' }])
  })

  await check('buildRequest: пользовательский Content-Type не дублируется авто-заголовком', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      headers: [{ id: '1', key: 'content-type', value: 'application/vnd.api+json', enabled: true }],
      body: { type: 'json', json: '{}' }
    })
    assert.deepEqual(built.headers, [{ key: 'content-type', value: 'application/vnd.api+json' }])
  })

  await check('buildRequest: тело urlencoded из таблицы с экранированием', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com/token',
      body: {
        type: 'urlencoded',
        urlencoded: [
          { id: '1', key: 'grant_type', value: 'client_credentials', enabled: true },
          { id: '2', key: 'client_id', value: 'abc', enabled: true },
          { id: '3', key: 'note', value: 'a b&c', enabled: true }
        ]
      }
    })
    assert.equal(built.body, 'grant_type=client_credentials&client_id=abc&note=a%20b%26c')
    assert.equal(built.headers[0].value, 'application/x-www-form-urlencoded')
  })

  await check('buildRequest: тело text без обработки и none без тела', () => {
    const text = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: { type: 'text', text: 'просто текст' }
    })
    assert.equal(text.body, 'просто текст')
    assert.equal(text.headers[0].value, 'text/plain')

    const none = http.buildRequest({ method: 'GET', url: 'https://api.example.com', body: { type: 'none' } })
    assert.equal(none.body, undefined)
    assert.deepEqual(none.headers, [])
  })

  await check('buildRequest: form-data собирается как multipart с границей', () => {
    const built = http.buildRequest({
      method: 'POST',
      url: 'https://api.example.com',
      body: {
        type: 'form-data',
        form: [
          { id: '1', key: 'field1', value: 'value1', enabled: true },
          { id: '2', key: '', value: 'skip', enabled: true },
          { id: '3', key: 'field2', value: 'value2', enabled: true }
        ]
      }
    })
    const ct = built.headers.find((h) => h.key === 'Content-Type')
    assert.ok(ct.value.startsWith('multipart/form-data; boundary=----postmanlite'), 'boundary в Content-Type')
    const boundary = ct.value.split('boundary=')[1]
    assert.ok(built.body.startsWith(`--${boundary}\r\n`))
    assert.ok(built.body.includes('Content-Disposition: form-data; name="field1"\r\n\r\nvalue1\r\n'))
    assert.ok(built.body.includes('name="field2"'))
    assert.ok(!built.body.includes('skip'), 'строка с пустым ключом не попадает в multipart')
    assert.ok(built.body.endsWith(`--${boundary}--\r\n`))
  })

  // --- HTTP: выполнение (sendRequest) на локальном сервере ---

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 500)
        return
      }
      if (req.url === '/hang') return // не отвечает: таймаут и отмена
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('x'.repeat(5000))
        return
      }
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'X-Served-By': 'smoke' })
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const closeServer = async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  try {
    await check('sendRequest выполняет GET с params, auth и заголовками, ответ содержит статус/время/тело', async () => {
      const response = await http.sendRequest(
        {
          method: 'GET',
          url: `${base}/users`,
          params: [{ id: '1', key: 'page', value: '2', enabled: true }],
          headers: [{ id: '2', key: 'X-Request-Source', value: 'postman-lite', enabled: true }],
          auth: { type: 'bearer', token: 't-secret-123' },
          body: { type: 'none' }
        },
        'smoke-1'
      )
      assert.equal(response.status, 201)
      assert.ok(Number.isFinite(response.timeMs) && response.timeMs >= 0)
      assert.ok(response.size > 0)
      assert.equal(response.truncated, false)
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers.authorization, 'Bearer t-secret-123')
      assert.equal(echo.headers['x-request-source'], 'postman-lite')
      assert.ok(echo.url.includes('page=2'))
      const served = response.headers.find((h) => h.key.toLowerCase() === 'x-served-by')
      assert.equal(served.value, 'smoke')
    })

    await check('sendRequest отправляет form-data так, как собрал buildRequest', async () => {
      const response = await http.sendRequest(
        {
          method: 'POST',
          url: `${base}/form`,
          body: {
            type: 'form-data',
            form: [
              { id: '1', key: 'field1', value: 'value1', enabled: true },
              { id: '2', key: 'field2', value: 'value2', enabled: true }
            ]
          }
        },
        'smoke-2'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers['content-type'].startsWith('multipart/form-data; boundary='), true)
      assert.ok(echo.body.includes('name="field1"'), 'сервер получил часть field1')
      assert.ok(echo.body.includes('value2'), 'сервер получил значение field2')
    })

    await check('sendRequest: cancelRequest прерывает выполнение кодом ABORTED', async () => {
      const pending = http.sendRequest({ method: 'GET', url: `${base}/slow` }, 'smoke-3')
      http.cancelRequest('smoke-3')
      await assert.rejects(pending, (err) => err.code === 'ABORTED')
    })

    await check('sendRequest: таймаут даёт код TIMEOUT', async () => {
      await assert.rejects(
        () => http.sendRequest({ method: 'GET', url: `${base}/hang` }, 'smoke-4', { timeoutMs: 100 }),
        (err) => err.code === 'TIMEOUT'
      )
    })

    await check('sendRequest: недоступный сервер даёт код NETWORK', async () => {
      // Порт 1 на 127.0.0.1 практически наверняка закрыт — соединение будет отклонено.
      await assert.rejects(
        () => http.sendRequest({ method: 'GET', url: 'http://127.0.0.1:1/nope' }, 'smoke-5'),
        (err) => err.code === 'NETWORK'
      )
    })

    await check('sendRequest: GET с телом отправляется без тела (как в Postman)', async () => {
      const response = await http.sendRequest(
        {
          method: 'GET',
          url: `${base}/get-with-body`,
          body: { type: 'json', json: '{"ignored":true}' }
        },
        'smoke-7'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.body, '', 'тело GET не ушло на сервер')
    })

    await check('sendRequest обрезает тело по лимиту и помечает truncated', async () => {
      const response = await http.sendRequest({ method: 'GET', url: `${base}/big` }, 'smoke-6', { bodyLimit: 1000 })
      assert.equal(response.size, 1000)
      assert.equal(response.body.length, 1000)
      assert.equal(response.truncated, true)
    })

    // --- Формат JSON (lib/format.js) ---

    await check('escapeHtml экранирует HTML-опасные символы', () => {
      assert.equal(
        format.escapeHtml(`<script>"'</script>`),
        '&lt;script&gt;&quot;&#39;&lt;/script&gt;'
      )
    })

    await check('prettyJson форматирует валидный JSON и возвращает null для невалидного', () => {
      assert.equal(format.prettyJson('{"a":1}'), '{\n  "a": 1\n}')
      assert.equal(format.prettyJson('не json'), null)
    })

    await check('highlightJson раскрашивает токены и экранирует содержимое строк', () => {
      const html = format.highlightJson('{"name":"<b>Ann</b>","age":30,"ok":true}')
      assert.ok(html.includes('<span class="tok-key">'), 'ключ раскрашен')
      assert.ok(html.includes('&lt;b&gt;Ann&lt;/b&gt;'), 'строка экранирована, XSS не пройдёт')
      assert.ok(html.includes('<span class="tok-number">30</span>'))
      assert.ok(html.includes('<span class="tok-bool">true</span>'))
      assert.ok(!html.includes('<b>'), 'сырой HTML в вывод не попадает')
    })

    // --- Дефолтные заголовки (lib/defaults.js) ---

    await check('DEFAULT_HEADERS: три включённых стандартных заголовка', () => {
      const keys = defaults.DEFAULT_HEADERS.map((h) => h.key)
      assert.deepEqual(keys, ['User-Agent', 'Accept', 'Accept-Language'])
      for (const header of defaults.DEFAULT_HEADERS) {
        assert.equal(header.enabled, true)
        assert.ok(header.key && header.value, 'ключ и значение заполнены')
      }
    })

    await check('DEFAULT_HEADERS отправляются вместо автозаголовков undici, без дублирования', async () => {
      const response = await http.sendRequest(
        { method: 'GET', url: `${base}/defaults`, headers: defaults.DEFAULT_HEADERS },
        'smoke-default-headers'
      )
      const echo = JSON.parse(response.body)
      assert.equal(echo.headers['user-agent'], 'PostmanLite/1.0')
      // Ровно одно значение — undici не добавил своё */* рядом с нашим Accept.
      assert.equal(echo.headers['accept'], 'application/json')
      assert.equal(echo.headers['accept-language'], 'ru-RU,ru;q=0.9')
    })

    await check('suggestRequestName: сегмент пути, hostname, невалидный URL', () => {
      assert.equal(requestName.suggestRequestName('https://example.com/api/users'), 'users')
      assert.equal(requestName.suggestRequestName('https://example.com/users?page=2'), 'users')
      assert.equal(requestName.suggestRequestName('https://example.com'), 'example.com')
      assert.equal(requestName.suggestRequestName('не URL'), '')
      assert.equal(requestName.suggestRequestName(''), '')
    })

    // --- Подстановка переменных окружения (lib/variables.js) ---

    await check('applyEnvironment подставляет url/params/headers/auth/body, выключенная — литерально', () => {
      const vars = variables.buildVars([
        { key: 'baseUrl', value: 'http://localhost:4545', enabled: true },
        { key: 'token', value: 't-1', enabled: true },
        { key: 'page', value: '2', enabled: true },
        { key: 'debug', value: '1', enabled: false }
      ])
      const resolved = variables.applyEnvironment(
        {
          url: '{{baseUrl}}/echo?page={{page}}',
          params: [{ id: 'p1', key: 'page', value: '{{page}}', enabled: true }],
          headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
          auth: { type: 'bearer', token: '{{token}}' },
          body: { type: 'json', json: '{"page":"{{page}}","debug":"{{debug}}"}' }
        },
        vars
      )
      assert.equal(resolved.url, 'http://localhost:4545/echo?page=2')
      assert.equal(resolved.params[0].value, '2')
      assert.equal(resolved.headers[0].value, 'Bearer t-1')
      assert.equal(resolved.auth.token, 't-1', 'auth-token подставляется')
      assert.equal(resolved.body.json, '{"page":"2","debug":"{{debug}}"}', 'выключенная переменная не подставляется')
    })

    await check('applyEnvironment: пустой словарь и неразрешённые плейсхолдеры литеральны', () => {
      const resolved = variables.applyEnvironment(
        { url: '{{baseUrl}}/x', params: [], headers: [], body: { type: 'text', text: '{{a}}{{b}}' } },
        variables.buildVars([])
      )
      assert.equal(resolved.url, '{{baseUrl}}/x')
      assert.equal(resolved.body.text, '{{a}}{{b}}')
    })

    await check('applyEnvironment подставляет ключи и значения в активном слоте body', () => {
      const vars = variables.buildVars([
        { key: 'k', value: 'fieldX', enabled: true },
        { key: 'v', value: 'valY', enabled: true }
      ])
      const formData = variables.applyEnvironment(
        {
          url: 'http://x',
          params: [],
          headers: [],
          body: { type: 'form-data', form: [{ id: 'f1', key: '{{k}}', value: '{{v}}', enabled: true }] }
        },
        vars
      )
      assert.equal(formData.body.form[0].key, 'fieldX')
      assert.equal(formData.body.form[0].value, 'valY')

      const urlencoded = variables.applyEnvironment(
        {
          url: 'http://x',
          params: [],
          headers: [],
          body: { type: 'urlencoded', urlencoded: [{ id: 'u1', key: '{{k}}', value: '{{v}}', enabled: true }] }
        },
        vars
      )
      assert.equal(urlencoded.body.urlencoded[0].key, 'fieldX')
      assert.equal(urlencoded.body.urlencoded[0].value, 'valY')
    })
  } finally {
    await closeServer()
  }

  console.log(`\nSMOKE OK: ${passed} проверок пройдено`)
} finally {
  await rm(root, { recursive: true, force: true })
}
