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

function resolveUnderLibrary(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null
  const root = path.resolve(getLibraryPath())
  const resolved = path.resolve(filePath)
  const rel = path.relative(root, resolved)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return resolved
}

function parseSemver(v) {
  const parts = String(v || '').replace(/^v/i, '').split(/[.+-]/).map((n) => parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

function isNewerVersion(latest, current) {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

function pickReleaseAsset(assets) {
  if (!Array.isArray(assets) || !assets.length) return null
  const names = assets.map((a) => ({ a, name: String(a.name || '').toLowerCase() }))
  if (process.platform === 'darwin') {
    const dmgs = names.filter((x) => x.name.endsWith('.dmg'))
    if (!dmgs.length) return null
    const preferArm = process.arch === 'arm64'
    const ranked = dmgs.slice().sort((x, y) => {
      const score = (n) => {
        let s = 0
        if (preferArm && /arm64|aarch64|apple.?silicon/.test(n)) s += 4
        if (!preferArm && /x64|amd64|intel/.test(n)) s += 4
        if (/universal/.test(n)) s += 2
        return s
      }
      return score(y.name) - score(x.name)
    })
    return ranked[0].a
  }
  if (process.platform === 'win32') {
    const exes = names.filter((x) => x.name.endsWith('.exe'))
    const preferred = exes.find((x) => /win.?x64|x64|portable/.test(x.name)) || exes[0]
    return preferred ? preferred.a : null
  }
  return null
}

ipcMain.handle('library:deleteFile', async (_e, filePath) => {
  try {
    const resolved = resolveUnderLibrary(filePath)
    if (!resolved) return { ok: false, error: 'Path is outside the library folder' }
    let st
    try {
      st = await fsp.stat(resolved)
    } catch {
      return { ok: false, error: 'File not found' }
    }
    if (!st.isFile()) return { ok: false, error: 'Not a regular file' }
    await fsp.unlink(resolved)
    const thumb = path.join(cacheDir(), `${hashPath(resolved)}.png`)
    try {
      if (fs.existsSync(thumb)) await fsp.unlink(thumb)
    } catch {
      // ignore thumb cleanup failures
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
})

ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('app:checkForUpdates', async () => {
  const current = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/scottf624-lab/printshelf/releases/latest', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `PrintShelf/${current}`,
      },
    })
    if (!res.ok) {
      return { ok: false, current, error: `GitHub API ${res.status}` }
    }
    const data = await res.json()
    const tag = String(data.tag_name || data.name || '').trim()
    const latest = tag.replace(/^v/i, '')
    if (!latest) return { ok: false, current, error: 'No release tag found' }
    const newer = isNewerVersion(latest, current)
    const asset = pickReleaseAsset(data.assets || [])
    return {
      ok: true,
      current,
      latest,
      newer,
      notes: typeof data.body === 'string' ? data.body : '',
      downloadUrl: asset && asset.browser_download_url ? asset.browser_download_url : null,
      htmlUrl: data.html_url || `https://github.com/scottf624-lab/printshelf/releases/latest`,
    }
  } catch (err) {
    return { ok: false, current, error: err && err.message ? err.message : String(err) }
  }
})

ipcMain.handle('app:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Only http(s) URLs are allowed' }
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com' && !parsed.hostname.endsWith('.github.com')) {
    return { ok: false, error: 'Only github.com URLs are allowed' }
  }
  await shell.openExternal(url)
  return { ok: true }
})
