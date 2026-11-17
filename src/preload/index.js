// Мост renderer ↔ main: единственная точка доступа к IPC — window.api.*.
// Renderer не имеет доступа к Node (nodeIntegration: false, contextIsolation: true).
import { contextBridge, ipcRenderer } from 'electron'

// Один блокирующий запрос на старте: сохранённая тема применяется до первого кадра
// (без вспышки тёмной темы при выбранной светлой).
const initialSettings = ipcRenderer.sendSync('settings:getInitial')

const api = {
  initialSettings,
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name) => ipcRenderer.invoke('projects:create', name),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', { id, name }),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  requests: {
    list: (projectId) => ipcRenderer.invoke('requests:list', projectId),
    save: (projectId, request) => ipcRenderer.invoke('requests:save', { projectId, request }),
    delete: (projectId, requestId) => ipcRenderer.invoke('requests:delete', { projectId, requestId })
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  http: {
    // requestId генерирует renderer и знает его ДО отправки — иначе Cancel во время
    // выполнения не сможет указать, какой запрос прервать.
    send: (requestId, request) =>
      ipcRenderer.invoke('http:request', { requestId, request }).then((result) => ({ requestId, ...result })),
    cancel: (requestId) => ipcRenderer.invoke('http:cancel', requestId)
  },
  onMenu: (callback) => {
    ipcRenderer.on('menu:new-project', () => callback('new-project'))
    ipcRenderer.on('menu:save-request', () => callback('save-request'))
  }
}

contextBridge.exposeInMainWorld('api', api)
