const path = require('path')

const NOTE_STATUSES = new Set(['', 'to-print', 'printed', 'reprint', 'failed'])

function normalizeRel(rel) {
  if (typeof rel !== 'string') return ''
  const raw = rel.replace(/\\/g, '/')
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return ''
  const parts = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return ''
    parts.push(part)
  }
  return parts.join('/')
}

function hashKey(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

function readNoteFields(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const status = NOTE_STATUSES.has(entry.status) ? entry.status : ''
  const note = typeof entry.note === 'string' ? entry.note : ''
  if (!status && !note) return null
  const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : undefined
  return { status, note, updatedAt }
}

function sanitizeEntry(entry) {
  const fields = readNoteFields(entry)
  if (!fields) return null
  const relative = typeof entry.relative === 'string' ? (normalizeRel(entry.relative) || null) : null
  const size = typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : null
  let hash = null
  if (typeof entry.hash === 'string' && /^[a-f0-9]{64}$/.test(entry.hash.trim().toLowerCase())) {
    hash = entry.hash.trim().toLowerCase()
  }
  const out = {
    relative,
    size,
    hash,
    status: fields.status,
    note: fields.note,
  }
  if (fields.updatedAt !== undefined) out.updatedAt = fields.updatedAt
  if (!relative && typeof entry.legacyPath === 'string' && entry.legacyPath) out.legacyPath = entry.legacyPath
  return out
}

function migrateLegacyMap(raw, libraryRoot, sizeByAbsolutePath = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  if (raw.version === 2 && Array.isArray(raw.entries)) {
    return raw.entries.map(sanitizeEntry).filter(Boolean)
  }
  const root = path.resolve(libraryRoot)
  const entries = []
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'version' || key === 'entries') continue
    const fields = readNoteFields(value)
    if (!fields) continue
    let relative = null
    let size = null
    let legacyPath = null
    if (path.isAbsolute(key)) {
      const abs = path.resolve(key)
      const rel = normalizeRel(path.relative(root, abs).split(path.sep).join('/'))
      if (rel) {
        relative = rel
        if (Object.prototype.hasOwnProperty.call(sizeByAbsolutePath, abs) && typeof sizeByAbsolutePath[abs] === 'number') {
          size = sizeByAbsolutePath[abs]
        }
      } else {
        legacyPath = abs
      }
    } else {
      const rel = normalizeRel(String(key))
      if (rel) relative = rel
      else legacyPath = String(key)
    }
    const entry = {
      relative,
      size,
      hash: null,
      status: fields.status,
      note: fields.note,
    }
    if (fields.updatedAt !== undefined) entry.updatedAt = fields.updatedAt
    if (legacyPath) entry.legacyPath = legacyPath
    entries.push(entry)
  }
  return entries
}

function matchNotes(files, notes) {
  const list = Array.isArray(files) ? files : []
  const source = Array.isArray(notes) ? notes : []
  const next = source.map((note) => ({ ...note }))
  const fileCount = list.length
  const noteCount = next.length
  const fileUsed = new Array(fileCount).fill(false)
  const noteUsed = new Array(noteCount).fill(false)
  const attachments = []
  const filesToHash = new Set()
  let changed = false

  function relOf(file) {
    return normalizeRel(file && file.relative)
  }

  const byRel = new Map()
  for (let i = 0; i < fileCount; i++) {
    const rel = relOf(list[i])
    if (!rel) continue
    if (!byRel.has(rel)) byRel.set(rel, [])
    byRel.get(rel).push(i)
  }

  for (let n = 0; n < noteCount; n++) {
    const note = next[n]
    const rel = normalizeRel(note && note.relative)
    if (!rel || typeof note.size !== 'number') continue
    const candidates = (byRel.get(rel) || []).filter((i) => !fileUsed[i] && list[i].size === note.size)
    if (candidates.length !== 1) continue
    const fileIndex = candidates[0]
    fileUsed[fileIndex] = true
    noteUsed[n] = true
    attachments.push({ fileIndex, noteIndex: n, via: 'path' })
    if (!hashKey(note.hash)) {
      const fileHash = hashKey(list[fileIndex].hash)
      if (fileHash) {
        if (note.hash !== fileHash) {
          note.hash = fileHash
          changed = true
        }
      } else {
        filesToHash.add(fileIndex)
      }
    }
  }

  const notesBySize = new Map()
  for (let n = 0; n < noteCount; n++) {
    if (noteUsed[n]) continue
    const note = next[n]
    if (!hashKey(note && note.hash) || typeof note.size !== 'number') continue
    if (!notesBySize.has(note.size)) notesBySize.set(note.size, [])
    notesBySize.get(note.size).push(n)
  }

  for (const [size, noteIndexes] of notesBySize) {
    const candidateFiles = []
    for (let i = 0; i < fileCount; i++) {
      if (fileUsed[i]) continue
      if (list[i].size !== size) continue
      if (!relOf(list[i])) continue
      candidateFiles.push(i)
    }
    const missing = candidateFiles.filter((i) => !hashKey(list[i].hash))
    if (missing.length) {
      for (const i of missing) filesToHash.add(i)
      continue
    }
    for (const n of noteIndexes) {
      if (noteUsed[n]) continue
      const hash = hashKey(next[n].hash)
      const hits = candidateFiles.filter((i) => !fileUsed[i] && hashKey(list[i].hash) === hash)
      if (hits.length !== 1) continue
      const fileIndex = hits[0]
      fileUsed[fileIndex] = true
      noteUsed[n] = true
      attachments.push({ fileIndex, noteIndex: n, via: 'hash' })
      const newRel = relOf(list[fileIndex])
      if (next[n].relative !== newRel) {
        next[n].relative = newRel
        changed = true
      }
    }
  }

  return {
    attachments,
    notes: next,
    filesToHash: [...filesToHash],
    changed,
  }
}

module.exports = {
  NOTE_STATUSES,
  normalizeRel,
  sanitizeEntry,
  migrateLegacyMap,
  matchNotes,
}
