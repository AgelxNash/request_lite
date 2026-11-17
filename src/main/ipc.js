// Регистрация IPC-каналов. Renderer общается с main только через эти ручки
// (см. src/preload/index.js). Префиксы: projects:*, settings:*, data:*.
import { ipcMain, shell } from 'electron'
import * as storage from './storage.js'

// Открывает папку хранилища в системном файловом менеджере (используется и меню).
export function openStorageFolder() {
  return shell.openPath(storage.getStorageRoot())
}

export function registerIpc() {
  ipcMain.handle('projects:list', () => storage.listProjects())
  ipcMain.handle('projects:create', (_event, name) => storage.createProject(name))
  ipcMain.handle('projects:rename', (_event, { id, name }) => storage.renameProject(id, name))
  ipcMain.handle('projects:delete', (_event, id) => storage.deleteProject(id))

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
}
