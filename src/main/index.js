// Точка входа main-процесса: окно, меню, инициализация хранилища и IPC.
import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { initStorage, bootstrap } from './storage.js'
import { registerIpc, openStorageFolder } from './ipc.js'

// __dirname доступен в ESM-выводе electron-vite (шим инжектится при сборке)

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1b1b', // тёмная тема по умолчанию — без белой вспышки при старте
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // preload собран в ESM (type: module в package.json) — песочница отключена;
      // renderer по-прежнему изолирован: nodeIntegration: false, contextIsolation: true (по умолчанию)
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const template = [
    {
      // На macOS первый пункт шаблона всегда становится меню приложения (метка заменяется именем app)
      label: app.name,
      submenu: [
        { label: 'О приложении', click: () => mainWindow?.webContents.send('menu:about') },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Файл',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-project')
        },
        {
          label: 'Save Request',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save-request')
        },
        {
          label: 'Вставить запрос из cURL',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu:import-curl')
        },
        {
          label: 'Импорт коллекции Postman',
          click: () => mainWindow?.webContents.send('menu:import-postman')
        },
        { label: 'Open data folder', click: () => openStorageFolder() }
      ]
    },
    { role: 'editMenu', label: 'Правка' },
    { role: 'viewMenu', label: 'Вид' },
    { role: 'windowMenu', label: 'Окно' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  // Дерево доступности веб-контента — для ассистивных технологий и UI-тестирования
  app.setAccessibilitySupportEnabled(true)
  // Хранилище закреплено за прежней папкой: переименование продукта (Request Lite)
  // иначе сменило бы userData и «потеряло» существующие проекты.
  app.setPath('userData', join(app.getPath('appData'), 'postman-lite'))
  initStorage(join(app.getPath('userData'), 'storage'))
  await bootstrap()
  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
