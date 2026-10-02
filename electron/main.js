const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const crypto = require('crypto')
const { pathToFileURL } = require('url')

const isDev = !app.isPackaged
const DEFAULT_LIBRARY = '/Volumes/Crucial X9/3D Prints'
const MODEL_EXTS = new Set(['.stl', '.3mf', '.svg'])

nativeTheme.themeSource = 'dark'

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
}

function getLibraryPath() {
  const saved = loadSettings().libraryPath
  if (typeof saved === 'string' && saved && fs.existsSync(saved)) return saved
  return DEFAULT_LIBRARY
}

function cacheDir() {
  return path.join(app.getPath('userData'), 'thumb-cache')
}

function hashPath(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex')
}

async function ensureCache() {
  await fsp.mkdir(cacheDir(), { recursive: true })
}

async function walkModels(root) {
  const results = []
  async function walk(dir) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (!MODEL_EXTS.has(ext)) continue
        let st
        try {
          st = await fsp.stat(full)
        } catch {
          continue
        }
        results.push({
          id: hashPath(full),
          name: entry.name,
          path: full,
          relative: path.relative(root, full),
          ext: ext.slice(1),
          size: st.size,
          mtime: st.mtimeMs,
        })
      }
    }
  }
  await walk(root)
  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return results
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  await ensureCache()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('library:defaultPath', () => getLibraryPath())

ipcMain.handle('library:pickFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    defaultPath: getLibraryPath(),
  })
  if (result.canceled || !result.filePaths[0]) return null
  const folder = result.filePaths[0]
  saveSettings({ libraryPath: folder })
  return folder
})

ipcMain.handle('library:scan', async (_e, root) => {
  const folder = root || getLibraryPath()
  const exists = fs.existsSync(folder)
  if (!exists) return { ok: false, error: `Folder not found: ${folder}`, models: [], root: folder }
  saveSettings({ libraryPath: folder })
  const models = await walkModels(folder)
  return { ok: true, models, root: folder, count: models.length }
})

ipcMain.handle('library:readFile', async (_e, filePath) => {
  const buf = await fsp.readFile(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

ipcMain.handle('library:fileUrl', (_e, filePath) => pathToFileURL(filePath).href)

ipcMain.handle('thumbs:getPath', async (_e, modelId) => {
  await ensureCache()
  const p = path.join(cacheDir(), `${modelId}.png`)
  if (!fs.existsSync(p)) return null
  const buf = await fsp.readFile(p)
  return `data:image/png;base64,${buf.toString('base64')}`
})

ipcMain.handle('thumbs:save', async (_e, modelId, dataUrl) => {
  await ensureCache()
  const p = path.join(cacheDir(), `${modelId}.png`)
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  await fsp.writeFile(p, Buffer.from(b64, 'base64'))
  return p
})

ipcMain.handle('thumbs:cacheDir', () => cacheDir())

ipcMain.handle('shell:showItem', (_e, filePath) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('shell:openPath', (_e, filePath) => shell.openPath(filePath))
