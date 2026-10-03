const assert = require('node:assert')
const { matchNotes, migrateLegacyMap } = require('./noteMatch')

function attachedFiles(result) {
  return result.attachments.map((item) => item.fileIndex)
}

// path + size match attaches, and a stored hash is not recomputed
{
  const files = [
    { relative: 'models/part.stl', size: 100 },
    { relative: 'models/other.stl', size: 100 },
  ]
  const notes = [{ relative: 'models/part.stl', size: 100, hash: 'abc', status: 'printed', note: 'brim' }]
  const result = matchNotes(files, notes)
  assert.deepEqual(attachedFiles(result), [0])
  assert.equal(result.attachments[0].via, 'path')
  assert.deepEqual(result.filesToHash, [])
  assert.equal(result.changed, false)
  assert.equal(result.notes[0].relative, 'models/part.stl')
  assert.equal(result.notes[0].hash, 'abc')
}

// same path, different size does not attach
{
  const files = [{ relative: 'models/part.stl', size: 250, hash: 'new-file' }]
  const notes = [{ relative: 'models/part.stl', size: 100, hash: 'old-file', status: 'printed', note: 'brim' }]
  const result = matchNotes(files, notes)
  assert.deepEqual(result.attachments, [])
  assert.equal(result.notes[0].relative, 'models/part.stl')
  assert.equal(result.changed, false)
}

// unique hash reattaches and updates the stored relative path
{
  const notes = [{ relative: 'models/part.stl', size: 100, hash: 'same-hash', status: 'to-print', note: 'layer' }]
  const files = [
    { relative: 'models/part-moved.stl', size: 100, hash: 'same-hash' },
    { relative: 'models/unrelated.stl', size: 100, hash: 'other-hash' },
  ]
  const result = matchNotes(files, notes)
  assert.deepEqual(attachedFiles(result), [0])
  assert.equal(result.attachments[0].via, 'hash')
  assert.equal(result.notes[0].relative, 'models/part-moved.stl')
  assert.equal(result.notes[0].size, 100)
  assert.equal(result.notes[0].hash, 'same-hash')
  assert.equal(result.notes[0].note, 'layer')
  assert.equal(notes[0].relative, 'models/part.stl')
  assert.equal(result.changed, true)
}

// two files with the same hash do not attach, and the stored path stays put
{
  const notes = [{ relative: 'models/part.stl', size: 100, hash: 'same-hash', status: 'printed', note: 'brim' }]
  const files = [
    { relative: 'models/a.stl', size: 100, hash: 'same-hash' },
    { relative: 'models/b.stl', size: 100, hash: 'same-hash' },
  ]
  const result = matchNotes(files, notes)
  assert.deepEqual(result.attachments, [])
  assert.equal(result.notes[0].relative, 'models/part.stl')
  assert.equal(result.changed, false)
  assert.deepEqual(result.filesToHash, [])
}

// a different file at the old path stays blank, even if the original is elsewhere
{
  const notes = [{ relative: 'models/part.stl', size: 100, hash: 'same-hash', status: 'failed', note: 'keep me' }]
  const files = [
    { relative: 'models/part.stl', size: 200, hash: 'replacement' },
    { relative: 'archive/part.stl', size: 100, hash: 'same-hash' },
  ]
  const result = matchNotes(files, notes)
  assert.deepEqual(attachedFiles(result), [1])
  assert.equal(result.attachments[0].via, 'hash')
  assert.equal(result.notes[0].relative, 'archive/part.stl')
  assert.ok(!attachedFiles(result).includes(0))
}

// no hash and a missing path does not ask for a library-wide hash
{
  const files = [
    { relative: 'models/other.stl', size: 100 },
    { relative: 'models/another.stl', size: 50 },
  ]
  const notes = [{ relative: 'models/gone.stl', size: 100, hash: null, status: 'printed', note: 'later' }]
  const result = matchNotes(files, notes)
  assert.deepEqual(result.attachments, [])
  assert.deepEqual(result.filesToHash, [])
}

// path + size with no stored hash hashes that file only
{
  const files = [
    { relative: 'models/part.stl', size: 100 },
    { relative: 'models/other.stl', size: 100 },
  ]
  const notes = [{ relative: 'models/part.stl', size: 100, hash: null, status: 'reprint', note: 'supports' }]
  const result = matchNotes(files, notes)
  assert.deepEqual(attachedFiles(result), [0])
  assert.deepEqual(result.filesToHash, [0])
}

// legacy absolute-path notes keep status and text, pick up size, and leave hash empty
{
  const migrated = migrateLegacyMap(
    {
      '/Volumes/Crucial X9/3D Prints/Folder/Part.stl': {
        status: 'printed',
        note: 'brim',
        updatedAt: 10,
      },
      '/tmp/outside.stl': {
        status: 'failed',
        note: 'keep',
      },
    },
    '/Volumes/Crucial X9/3D Prints',
    { '/Volumes/Crucial X9/3D Prints/Folder/Part.stl': 42 },
  )
  assert.equal(migrated[0].relative, 'Folder/Part.stl')
  assert.equal(migrated[0].size, 42)
  assert.equal(migrated[0].hash, null)
  assert.equal(migrated[0].status, 'printed')
  assert.equal(migrated[0].note, 'brim')
  assert.equal(migrated[0].updatedAt, 10)
  assert.equal(migrated[1].relative, null)
  assert.equal(migrated[1].status, 'failed')
  assert.equal(migrated[1].note, 'keep')
  assert.equal(migrated[1].hash, null)
  assert.equal(migrated[1].size, null)
}

console.log('noteMatch tests passed')
