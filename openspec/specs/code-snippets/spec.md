# code-snippets Specification

## Purpose

Генерация кода запроса на языках клиента из снимка запроса: рядом с командой cURL запрос превращается в готовый к запуску код на JavaScript (fetch, axios) или Python (requests), переносящий метод, URL, заголовки, авторизацию и тело.

## Requirements

### Requirement: Набор языков сниппетов
Система SHALL генерировать из одного снимка запроса сниппеты на трёх языках: JavaScript Fetch, JavaScript Axios (ESM) и Python Requests. Сниппеты одного снимка SHALL описывать один и тот же запрос; неизвестный язык SHALL давать понятную ошибку.

#### Scenario: Один снимок — три языка
- **WHEN** снимок с методом POST, bearer-токеном `t-1` и json-телом `{"name":"Ann"}` генерируется для Fetch, Axios и Python
- **THEN** каждый сниппет содержит метод POST, заголовок `Authorization` со значением `Bearer t-1`, `Content-Type: application/json` и тело `{"name":"Ann"}`

#### Scenario: Неизвестный язык
- **WHEN** генерация запрашивается для языка, которого нет в наборе
- **THEN** возвращается понятная ошибка с именем неизвестного языка

### Requirement: Перенос метода и URL
Сниппет SHALL отправлять метод снимка и использовать URL снимка со всеми включёнными параметрами (непустой ключ, включённая галочка) в виде query-строки. Apikey-авторизация с размещением в query SHALL попадать в URL.

#### Scenario: Метод снимка
- **WHEN** снимок имеет метод PUT
- **THEN** сниппет Fetch содержит `method: 'PUT'`, Axios — `method: 'put'`, Python — `requests.put(`

#### Scenario: Параметры снимка в URL
- **WHEN** снимок имеет URL `https://api.example.com/users` и включённый параметр `page=2`
- **THEN** URL сниппета каждого языка — `https://api.example.com/users?page=2`

#### Scenario: Apikey в query
- **WHEN** у снимка auth apikey с ключом `api_key`, значением `k-1` и размещением «Query-параметр»
- **THEN** URL сниппета содержит `api_key=k-1`, а среди заголовков сниппета нет `api_key`

#### Scenario: Выключенный параметр
- **WHEN** у снимка есть выключенный параметр `token=abc`
- **THEN** URL сниппета не содержит `token=abc`

### Requirement: Заголовки снимка и автоматический Content-Type
Сниппет SHALL содержать каждый включённый заголовок снимка с непустым именем. Для тела json, text или urlencoded SHALL добавляться автоматический `Content-Type` (`application/json`, `text/plain`, `application/x-www-form-urlencoded`), если пользователь не задал свой.

#### Scenario: Автоматический Content-Type для json
- **WHEN** у снимка тело json и в заголовках нет `Content-Type`
- **THEN** сниппет содержит ровно один `Content-Type` со значением `application/json`

#### Scenario: Пользовательский Content-Type
- **WHEN** у снимка тело json и включённый заголовок `Content-Type: application/vnd.api+json`
- **THEN** сниппет содержит `Content-Type` только со значением `application/vnd.api+json`

#### Scenario: Выключенные заголовки и строки без имени
- **WHEN** у снимка есть выключенный заголовок `X-Skip: no` и включённая строка с пустым именем
- **THEN** сниппет не содержит ни `X-Skip`, ни строки без имени

### Requirement: Bearer и apikey в заголовках
Bearer-авторизация SHALL переноситься в сниппет заголовком `Authorization: Bearer <токен>` при непустом токене; apikey-авторизация с размещением в заголовке — заголовком `<ключ>: <значение>` при непустом ключе.

#### Scenario: Bearer-токен
- **WHEN** у снимка auth bearer с токеном `t-1`
- **THEN** сниппет содержит заголовок `Authorization` со значением `Bearer t-1`

#### Scenario: Apikey в заголовке
- **WHEN** у снимка auth apikey с ключом `X-Api-Key` и значением `k-1`
- **THEN** сниппет содержит заголовок `X-Api-Key` со значением `k-1`

### Requirement: Basic-авторизация
Для basic-авторизации сниппет SHALL переносить логин и пароль снимка: Fetch — заголовком `Authorization: Basic <base64>`, равным отправляемому приложением; Axios и Python — штатной опцией клиента с логином и паролем.

#### Scenario: Basic без переменных
- **WHEN** у снимка auth basic с логином `user` и паролем `p@ss`
- **THEN** сниппет Fetch содержит `Authorization` со значением `Basic dXNlcjpwQHNz`, Axios — `auth: { username: 'user', password: 'p@ss' }`, Python — `auth=('user', 'p@ss')`

#### Scenario: Basic с переменными
- **WHEN** логин и пароль содержат `{{user}}` и `{{pass}}`
- **THEN** сниппет Fetch вычисляет заголовок при выполнении выражением `btoa('{{user}}:{{pass}}')`, Axios — `auth: { username: '{{user}}', password: '{{pass}}' }`

### Requirement: Дубликаты имён заголовков
При повторении имени заголовка в снимке без учёта регистра сниппет SHALL содержать одно значение имени — последнее по порядку снимка; ранние вхождения отбрасываются.

#### Scenario: Пользовательский Authorization поверх bearer
- **WHEN** у снимка bearer-токен `t-1` и включённый пользовательский заголовок `authorization: Custom x`
- **THEN** сниппет содержит ровно одно имя `authorization` (без учёта регистра) со значением `Custom x`

### Requirement: Тело json и text сырой строкой
Тело json или text SHALL переноситься в сниппет одним строковым литералом байт в байт как в снимке, без повторной сериализации JSON, включая невалидный JSON.

#### Scenario: Тело без изменений
- **WHEN** тело json снимка — `{"name":"Ann"}` с лишним пробелом перед двоеточием
- **THEN** сниппет каждого языка содержит литерал с тем же текстом `{"name" :"Ann"}`

#### Scenario: Невалидный JSON
- **WHEN** тело json снимка — `{"name":"Ann",}` (невалидный JSON)
- **THEN** сниппет каждого языка содержит это тело тем же текстом, без перестроения и без ошибки

### Requirement: Тело urlencoded парами
Тело urlencoded SHALL переноситься парами «ключ — значение» сырыми строками снимка; кодирование SHALL выполнять клиент при выполнении сниппета. Выключенные строки и строки без ключа не переносятся.

#### Scenario: Пары urlencoded во Fetch
- **WHEN** тело urlencoded содержит включённые пары `grant_type=client_credentials`, `client_id=ab c&d` и выключенную пару `skip=x`
- **THEN** сниппет Fetch содержит `body.append('grant_type', 'client_credentials')` и `body.append('client_id', 'ab c&d')`, без `skip`

#### Scenario: Пары urlencoded в Python
- **WHEN** тот же снимок генерируется для Python
- **THEN** сниппет содержит `data={'grant_type': 'client_credentials', 'client_id': 'ab c&d'}`, без `skip`

### Requirement: Тело form-data парами
Тело form-data SHALL переноситься парами «ключ — значение» сырыми строками снимка в виде составного тела (multipart). Автоматический `Content-Type` SHALL отсутствовать — его ставит клиент с корректным boundary.

#### Scenario: Пары form-data
- **WHEN** тело form-data содержит включённые пары `field1=value1`, `field2=привет` и выключенную пару `skip=x`
- **THEN** сниппет Fetch содержит `body.append('field1', 'value1')` и `body.append('field2', 'привет')`, Python — `files={'field1': (None, 'value1'), 'field2': (None, 'привет')}`, без `skip` и без `Content-Type`

### Requirement: GET и HEAD без тела
Для методов GET и HEAD сниппет SHALL строиться без тела независимо от выбранного типа тела и без автоматического `Content-Type`.

#### Scenario: GET с заполненным json-телом
- **WHEN** снимок имеет метод GET и тело json `{"x":1}`
- **THEN** сниппет каждого языка не содержит тела и автоматического `Content-Type: application/json`

### Requirement: Переменные литерально
Сниппет SHALL переносить `{{var}}` литерально во всех строковых полях — URL, заголовках, учётных данных, теле — не подставляя значения активного окружения.

#### Scenario: Переменные литерально
- **WHEN** снимок содержит URL `{{baseUrl}}/users` и включённый заголовок `X-Token: {{token}}`
- **THEN** сниппет каждого языка содержит литеральные `{{baseUrl}}` и `{{token}}`

### Requirement: Экранирование строковых литералов
Строковые значения снимка SHALL попадать в сниппет корректными строковыми литералами своего языка: кавычки, обратные слеши и управляющие символы экранируются, при выполнении литерал разворачивается в исходный текст.

#### Scenario: Кавычки, слеш и перевод строки
- **WHEN** значение включённого заголовка — `it's "quoted" \ ${x}` с переводом строки внутри
- **THEN** сниппет каждого языка синтаксически корректен, а литерал заголовка разворачивается в исходный текст

### Requirement: Сниппет воспроизводит запрос приложения
Для снимка без переменных `{{var}}` выполненный сниппет SHALL отправить тот же HTTP-запрос, что приложение: метод, URL, заголовки и тело.

#### Scenario: Fetch с bearer и json-телом
- **WHEN** снимок с методом POST, URL `https://api.example.com/users`, bearer-токеном `t-1` и json-телом `{"name":"Ann"}` генерируется для Fetch
- **THEN** сниппет вызывает `fetch('https://api.example.com/users', {` с заголовком `Authorization` со значением `Bearer t-1`, `Content-Type: application/json` и `body: '{"name":"Ann"}'`

#### Scenario: Тот же запрос на echo-сервере
- **WHEN** сниппет Fetch для снимка с параметрами, заголовками, bearer и телом выполняется против echo-сервера
- **THEN** сервер получает те же метод, URL, заголовки и тело, что при отправке снимка из приложения

#### Scenario: Multipart из сниппета
- **WHEN** выполняется сниппет Fetch для снимка с form-data
- **THEN** сервер получает те же имена полей и значения multipart, что при отправке из приложения (boundary может отличаться)

### Requirement: Законченный код
Сниппет SHALL быть законченным кодом: при отсутствии `{{var}}` он запускается без правок — содержит подключение клиента (для Axios и Python) и завершается выводом статуса и тела ответа.

#### Scenario: Вывод ответа
- **WHEN** сниппет сгенерирован для любого языка
- **THEN** Fetch содержит `console.log(response.status, await response.text())`, Axios — `console.log(response.status, response.data)`, Python — `print(response.status_code, response.text)`
