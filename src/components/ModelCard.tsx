import { useEffect, useState } from 'react'
import type { ModelInfo } from '../vite-env'
import { formatBytes } from '../lib/format'
import { renderModelThumb } from '../lib/renderThumb'

type Props = {
  model: ModelInfo
  selected: boolean
  onSelect: () => void
  priority: boolean
}

export function ModelCard({ model, selected, onSelect, priority }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!priority && !src) return
      try {
        const cached = await window.printshelf.getThumbPath(model.id)
        if (cancelled) return
        if (cached) {
          setSrc(cached)
          return
        }
        setLoading(true)
        const buf = await window.printshelf.readFile(model.path)
        if (cancelled) return
        const dataUrl = await renderModelThumb(buf, model.ext)
        if (cancelled) return
        await window.printshelf.saveThumb(model.id, dataUrl)
        if (cancelled) return
        setSrc(dataUrl)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [model.id, model.path, model.ext, priority])

  return (
    <article className={`card ${selected ? 'selected' : ''}`} onClick={onSelect} title={model.relative}>
      <div className="thumb">
        {src ? <img src={src} alt="" loading="lazy" /> : loading ? <div className="spinner" /> : failed ? <span style={{ color: '#fb7185', fontSize: 12 }}>Failed</span> : <div className="spinner" style={{ opacity: 0.35 }} />}
        <span className="badge">{model.ext}</span>
      </div>
      <div className="card-body">
        <div className="card-title">{model.name}</div>
        <div className="card-sub">{formatBytes(model.size)}</div>
      </div>
    </article>
  )
}
