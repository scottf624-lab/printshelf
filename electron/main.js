const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const crypto = require('crypto')
const { NOTE_STATUSES, normalizeRel, sanitizeEntry, migrateLegacyMap, matchNotes } = require('./noteMatch')
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
  if (!exists) return { ok: false, error: `Folder not found: ${folder}`, models: [], root: folder, notes: {} }
  saveSettings({ libraryPath: folder })
  const models = await walkModels(folder)
  const notes = await withNotesLock(() => resolveLibraryNotes(folder, models))
  return { ok: true, models, root: folder, count: models.length, notes }
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


let notesQueue = Promise.resolve()

function withNotesLock(fn) {
  const run = notesQueue.then(fn, fn)
  notesQueue = run.then(() => {}, () => {})
  return run
}

function notesFilePath() {
  return path.join(app.getPath('userData'), 'notes.json')
}

function notesLibraryRoot() {
  const saved = loadSettings().libraryPath
  if (typeof saved === 'string' && saved.trim()) return saved
  return DEFAULT_LIBRARY
}

function relativeToLibrary(root, filePath) {
  if (typeof root !== 'string' || !root || typeof filePath !== 'string' || !filePath) return null
  const rel = path.relative(path.resolve(root), path.resolve(filePath))
  const normal = normalizeRel(rel.split(path.sep).join('/'))
  return normal || null
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function loadNotesStore() {
  const file = notesFilePath()
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return []
  }
  if (raw && raw.version === 2 && Array.isArray(raw.entries)) {
    return raw.entries.map(sanitizeEntry).filter(Boolean)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const root = notesLibraryRoot()
  const sizes = {}
  for (const key of Object.keys(raw)) {
    if (!path.isAbsolute(key)) continue
    const abs = path.resolve(key)
    try {
      const st = fs.statSync(abs)
      if (st.isFile()) sizes[abs] = st.size
    } catch {
      // missing file: keep the note, leave size and hash empty
    }
  }
  const entries = migrateLegacyMap(raw, root, sizes).map(sanitizeEntry).filter(Boolean)
  saveNotesStore(entries)
  return entries
}

function saveNotesStore(entries) {
  const clean = []
  for (const entry of entries) {
    const sanitized = sanitizeEntry(entry)
    if (sanitized) clean.push(sanitized)
  }
  fs.mkdirSync(path.dirname(notesFilePath()), { recursive: true })
  fs.writeFileSync(notesFilePath(), JSON.stringify({ version: 2, entries: clean }, null, 2))
}

function noteRow(entry) {
  const row = { status: entry.status, note: entry.note }
  if (typeof entry.updatedAt === 'number') row.updatedAt = entry.updatedAt
  return row
}

async function resolveLibraryNotes(root, models) {
  const entries = loadNotesStore()
  const files = models.map((model) => ({
    relative: relativeToLibrary(root, model.path) || normalizeRel(model.relative),
    size: model.size,
    hash: null,
    path: model.path,
  }))
  let result = matchNotes(files, entries)
  if (result.filesToHash.length) {
    for (const index of result.filesToHash) {
      if (files[index].hash) continue
      try {
        files[index].hash = await hashFile(files[index].path)
      } catch {
        files[index].hash = null
      }
    }
    result = matchNotes(files, entries)
  }
  if (result.changed) saveNotesStore(result.notes)
  const byPath = {}
  for (const attachment of result.attachments) {
    const model = models[attachment.fileIndex]
    const entry = result.notes[attachment.noteIndex]
    if (!model || !entry) continue
    byPath[model.path] = noteRow(entry)
  }
  return byPath
}

function findNoteIndex(entries, relative, size, hash) {
  const byPath = []
  entries.forEach((entry, index) => {
    if (entry.relative === relative && entry.size === size) byPath.push(index)
  })
  if (byPath.length >= 1) return byPath[0]
  if (!hash) return -1
  const byHash = []
  entries.forEach((entry, index) => {
    if (entry.hash && entry.hash === hash && entry.size === size) byHash.push(index)
  })
  if (byHash.length === 1) return byHash[0]
  return -1
}

function rekeyNote(oldPath, newPath) {
  const root = path.resolve(getLibraryPath())
  const oldRel = relativeToLibrary(root, oldPath)
  const newRel = relativeToLibrary(root, newPath)
  if (!oldRel || !newRel || oldRel === newRel) return
  let size = null
  try {
    const st = fs.statSync(newPath)
    if (!st.isFile()) return
    size = st.size
  } catch {
    return
  }
  const entries = loadNotesStore().map((entry) => ({ ...entry }))
  const sized = []
  const sameRel = []
  entries.forEach((entry, index) => {
    if (entry.relative !== oldRel) return
    sameRel.push(index)
    if (entry.size === size) sized.push(index)
  })
  let index = -1
  if (sized.length === 1) index = sized[0]
  else if (!sized.length && sameRel.length === 1) index = sameRel[0]
  if (index < 0) return
  const entry = entries[index]
  entry.relative = newRel
  if (typeof entry.size !== 'number') entry.size = size
  saveNotesStore(entries)
}

function sanitizeFileName(currentName, newName) {
  if (typeof newName !== 'string') return { error: 'Invalid file name' }
  let name = newName.trim()
  if (!name) return { error: 'Name cannot be empty' }
  if (name === '.' || name === '..') return { error: 'Invalid file name' }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { error: 'Name cannot include a path' }
  }
  const origExt = path.extname(currentName || '')
  const newExt = path.extname(name)
  if (!newExt || newExt === '.') {
    name = name.replace(/\.+$/, '')
    if (origExt) name += origExt
  }
  if (!name || name === '.' || name === '..') return { error: 'Invalid file name' }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { error: 'Name cannot include a path' }
  }
  return { name }
}

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
    try {
      await shell.trashItem(resolved)
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
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


ipcMain.handle('library:renameFile', (_e, oldPath, newName) => withNotesLock(async () => {
  try {
    const resolvedOld = resolveUnderLibrary(oldPath)
    if (!resolvedOld) return { ok: false, error: 'Path is outside the library folder' }
    let st
    try {
      st = await fsp.stat(resolvedOld)
    } catch {
      return { ok: false, error: 'File not found' }
    }
    if (!st.isFile()) return { ok: false, error: 'Not a regular file' }

    const sanitized = sanitizeFileName(path.basename(resolvedOld), newName)
    if (sanitized.error) return { ok: false, error: sanitized.error }

    const libraryRoot = path.resolve(getLibraryPath())
    const newPath = path.join(path.dirname(resolvedOld), sanitized.name)
    const resolvedNew = resolveUnderLibrary(newPath)
    if (!resolvedNew) return { ok: false, error: 'Path is outside the library folder' }

    if (fs.existsSync(resolvedNew)) {
      let same = false
      try {
        const dest = await fsp.stat(resolvedNew)
        same = dest.ino === st.ino && dest.dev === st.dev
      } catch {
        same = false
      }
      if (!same) return { ok: false, error: 'A file with that name already exists' }
    }

    if (resolvedOld !== resolvedNew) {
      await fsp.rename(resolvedOld, resolvedNew)
      try {
        rekeyNote(resolvedOld, resolvedNew)
      } catch {
        // rename already happened
      }
      const oldThumb = path.join(cacheDir(), `${hashPath(resolvedOld)}.png`)
      const newThumb = path.join(cacheDir(), `${hashPath(resolvedNew)}.png`)
      if (oldThumb !== newThumb && fs.existsSync(oldThumb)) {
        try {
          await fsp.copyFile(oldThumb, newThumb)
          await fsp.unlink(oldThumb)
        } catch {
          // ignore thumb move failures
        }
      }
    }

    return {
      ok: true,
      path: resolvedNew,
      name: path.basename(resolvedNew),
      relative: path.relative(libraryRoot, resolvedNew),
      id: hashPath(resolvedNew),
    }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
}))

ipcMain.handle('notes:get', (_e, filePath) => withNotesLock(async () => {
  const resolved = resolveUnderLibrary(filePath)
  if (!resolved) return { status: '', note: '' }
  let st
  try {
    st = await fsp.stat(resolved)
  } catch {
    return { status: '', note: '' }
  }
  if (!st.isFile()) return { status: '', note: '' }
  const relative = relativeToLibrary(getLibraryPath(), resolved)
  if (!relative) return { status: '', note: '' }
  const entries = loadNotesStore().map((entry) => ({ ...entry }))
  const index = findNoteIndex(entries, relative, st.size, null)
  if (index < 0) return { status: '', note: '' }
  const entry = entries[index]
  if (!entry.hash) {
    try {
      entry.hash = await hashFile(resolved)
      saveNotesStore(entries)
    } catch {
      // leave the hash empty until the next save or scan
    }
  }
  return { status: entry.status, note: entry.note }
}))

ipcMain.handle('notes:set', (_e, filePath, payload) => withNotesLock(async () => {
  try {
    const resolved = resolveUnderLibrary(filePath)
    if (!resolved) return { ok: false, error: 'Path is outside the library folder' }
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid notes' }
    if (!NOTE_STATUSES.has(payload.status)) return { ok: false, error: 'Invalid status' }
    if (typeof payload.note !== 'string') return { ok: false, error: 'Invalid note' }
    const status = payload.status
    const note = payload.note
    let st
    try {
      st = await fsp.stat(resolved)
    } catch {
      return { ok: false, error: 'File not found' }
    }
    if (!st.isFile()) return { ok: false, error: 'Not a regular file' }
    const relative = relativeToLibrary(getLibraryPath(), resolved)
    if (!relative) return { ok: false, error: 'Path is outside the library folder' }
    let hash
    try {
      hash = await hashFile(resolved)
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
    const entries = loadNotesStore().map((entry) => ({ ...entry }))
    const index = findNoteIndex(entries, relative, st.size, hash)
    if (!status && !note.trim()) {
      if (index >= 0) {
        entries.splice(index, 1)
        saveNotesStore(entries)
      }
      return { ok: true, status, note }
    }
    const record = {
      relative,
      size: st.size,
      hash,
      status,
      note,
      updatedAt: Date.now(),
    }
    if (index >= 0) entries[index] = record
    else entries.push(record)
    saveNotesStore(entries)
    return { ok: true, status, note }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) }
  }
}))

ipcMain.handle('notes:map', () => withNotesLock(async () => {
  const root = getLibraryPath()
  if (!fs.existsSync(root)) return {}
  const models = await walkModels(root)
  return resolveLibraryNotes(root, models)
}))

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
