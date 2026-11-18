// Регистрация IPC-каналов. Renderer общается с main только через эти ручки
// (см. src/preload/index.js). Префиксы: projects:*, requests:*, environments:*,
// settings:*, http:*, postman:*, data:*, clipboard:*.
import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import * as storage from './storage.js'
import { sendRequest, cancelRequest } from './http.js'

// Открывает папку хранилища в системном файловом менеджере (используется и меню).
export function openStorageFolder() {
  return shell.openPath(storage.getStorageRoot())
}

export function registerIpc() {
  ipcMain.handle('projects:list', () => storage.listProjects())
  ipcMain.handle('projects:create', (_event, name) => storage.createProject(name))
  ipcMain.handle('projects:rename', (_event, { id, name }) => storage.renameProject(id, name))
  ipcMain.handle('projects:delete', (_event, id) => storage.deleteProject(id))
  ipcMain.handle('projects:setLocked', (_event, { id, locked }) => storage.setProjectLocked(id, locked))
  ipcMain.handle('projects:reorder', (_event, { id, toIndex }) => storage.reorderProjects(id, toIndex))
  ipcMain.handle('projects:importCollection', (_event, payload) => storage.importCollection(payload))

  // Выбор JSON-файла коллекции Postman + чтение содержимого (нативный диалог в main).
  ipcMain.handle('postman:pickAndRead', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Postman Collection', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true }
    try {
      const content = await readFile(result.filePaths[0], 'utf8')
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: `Не удалось прочитать файл: ${err.message}` }
    }
  })

  ipcMain.handle('requests:list', (_event, projectId) => storage.listRequests(projectId))
  ipcMain.handle('requests:save', (_event, { projectId, request }) => storage.saveRequest(projectId, request))
  ipcMain.handle('requests:delete', (_event, { projectId, requestId }) =>
    storage.deleteRequest(projectId, requestId)
  )
  ipcMain.handle('requests:setLocked', (_event, { projectId, requestId, locked }) =>
    storage.setRequestLocked(projectId, requestId, locked)
  )
  ipcMain.handle('requests:reorder', (_event, { projectId, requestId, toIndex }) =>
    storage.reorderRequests(projectId, requestId, toIndex)
  )

  ipcMain.handle('environments:list', (_event, projectId) => storage.listEnvironments(projectId))
  ipcMain.handle('environments:save', (_event, { projectId, environment }) =>
    storage.saveEnvironment(projectId, environment)
  )
  ipcMain.handle('environments:delete', (_event, { projectId, environmentId }) =>
    storage.deleteEnvironment(projectId, environmentId)
  )
  ipcMain.handle('environments:setActive', (_event, { projectId, environmentId }) =>
    storage.setActiveEnvironment(projectId, environmentId)
  )

  // Копирование в системный буфер (renderer-clipboard требует permission handler — идём через main).
  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })

  // Версия приложения (единый источник — package.json через app.getVersion).
  ipcMain.handle('app:version', () => app.getVersion())

  // Открытие внешних ссылок: только https — защита от произвольных схем.
  ipcMain.handle('shell:openExternal', (_event, url) => {
    const value = String(url ?? '')
    if (!/^https:\/\//i.test(value)) throw new Error('Разрешены только https-ссылки')
    return shell.openExternal(value)
  })

  ipcMain.handle('settings:get', () => storage.getSettings())
  ipcMain.handle('settings:set', (_event, patch) => storage.setSettings(patch))
  // Блокирующий канал для preload: начальные настройки до первого кадра (тема без вспышки).
  ipcMain.on('settings:getInitial', (event) => {
    event.returnValue = storage.getSettingsSync()
  })

  ipcMain.handle('data:openFolder', async () => {
    const error = await openStorageFolder()
    // shell.openPath возвращает '' при успехе, иначе текст ошибки
    return error === '' ? { ok: true } : { ok: false, error }
  })

  // HTTP: выполнение строго в main; renderer присылает снимок вкладки + requestId.
  ipcMain.handle('http:request', async (_event, { requestId, request }) => {
    try {
      const response = await sendRequest(request, requestId)
      return { ok: true, response }
    } catch (err) {
      return { ok: false, error: { code: err.code ?? 'NETWORK', message: err.message } }
    }
  })
  ipcMain.handle('http:cancel', (_event, requestId) => {
    cancelRequest(requestId)
    return true
  })
}
