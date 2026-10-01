import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelInfo } from './vite-env'
import { ModelCard } from './components/ModelCard'
import { ModelViewer } from './components/ModelViewer'
import { formatBytes } from './lib/format'
import { LICENSE_TEXT } from './lib/licenseText'

export default function App() {
  const [root, setRoot] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'stl' | '3mf' | 'svg'>('all')
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [aboutOpen, setAboutOpen] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const scan = useCallback(async (folder?: string) => {
    setStatus('loading')
    setError('')
    setSelected(null)
    const result = await window.printshelf.scan(folder)
    if (!result.ok) {
      setStatus('error')
      setError(result.error || 'Scan failed')
      setRoot(result.root)
      setModels([])
      return
    }
    setRoot(result.root)
    setModels(result.models)
    setStatus('ready')
  }, [])

  useEffect(() => {
    ;(async () => {
      const def = await window.printshelf.defaultPath()
      setRoot(def)
      await scan(def)
    })()
  }, [scan])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.id
            if (!id) continue
            if (e.isIntersecting) next.add(id)
          }
          return next
        })
      },
      { rootMargin: '400px' },
    )
    return () => observerRef.current?.disconnect()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter((m) => {
      if (filter !== 'all' && m.ext !== filter) return false
      if (!q) return true
      return m.name.toLowerCase().includes(q) || m.relative.toLowerCase().includes(q)
    })
  }, [models, query, filter])

  const totalBytes = useMemo(() => models.reduce((s, m) => s + m.size, 0), [models])

  async function pickFolder() {
    const folder = await window.printshelf.pickFolder()
    if (folder) await scan(folder)
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark" />
          <span>PrintShelf</span>
        </div>
        <input
          className="search"
          placeholder="Search models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="btn"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'stl' | '3mf' | 'svg')}
          style={{ paddingRight: 28 }}
        >
          <option value="all">All types</option>
          <option value="stl">STL</option>
          <option value="3mf">3MF</option>
          <option value="svg">SVG</option>
        </select>
        <div className="meta">
          {status === 'ready'
            ? `${filtered.length.toLocaleString()} shown · ${models.length.toLocaleString()} total · ${formatBytes(totalBytes)}`
            : status === 'loading'
              ? 'Scanning…'
              : 'Ready'}
        </div>
        <button className="btn" onClick={() => scan(root)}>Refresh</button>
        <button className="btn primary" onClick={pickFolder}>Choose folder</button>
        <button className="about-btn" title="About & license" onClick={() => setAboutOpen(true)}>i</button>
      </header>

      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>PrintShelf</h2>
            <div className="sub">v0.1.0 · Free for personal use · © 2026 French Solutions, LLC</div>
            <pre>{LICENSE_TEXT}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={() => setAboutOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="status"><h2>Scanning library…</h2><p className="empty-hint">{root || 'Looking for your models'}</p></div>
      )}

      {status === 'error' && (
        <div className="status">
          <h2>Can’t open that folder</h2>
          <p className="error">{error}</p>
          <p className="empty-hint">Pick the folder that holds your STL, 3MF, and SVG files.</p>
          <button className="btn primary" onClick={pickFolder}>Choose folder</button>
        </div>
      )}

      {status === 'ready' && (
        <div className="layout">
          <div className="grid-wrap">
            {filtered.length === 0 ? (
              <div className="status">
                <h2>No matches</h2>
                <p className="empty-hint">Try another search or filter.</p>
              </div>
            ) : (
              <div className="grid">
                {filtered.map((m, i) => (
                  <div
                    key={m.id}
                    data-id={m.id}
                    ref={(el) => {
                      if (el) observerRef.current?.observe(el)
                    }}
                  >
                    <ModelCard
                      model={m}
                      selected={selected?.id === m.id}
                      onSelect={() => setSelected(m)}
                      priority={visible.has(m.id) || i < 24}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <aside className="detail">
            <ModelViewer model={selected} />
            <div className="detail-panel">
              {selected ? (
                <>
                  <div className="detail-title">{selected.name}</div>
                  <div className="detail-row"><span>Type</span><strong>{selected.ext.toUpperCase()}</strong></div>
                  <div className="detail-row"><span>Size</span><strong>{formatBytes(selected.size)}</strong></div>
                  <div className="detail-row"><span>Path</span><strong style={{ textAlign: 'right', maxWidth: '65%' }}>{selected.relative}</strong></div>
                  <div className="detail-actions">
                    <button className="btn primary" onClick={() => window.printshelf.openPath(selected.path)}>Open file</button>
                    <button className="btn" onClick={() => window.printshelf.showInFolder(selected.path)}>Show in Finder</button>
                  </div>
                </>
              ) : (
                <div className="meta">Library: {root}</div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
