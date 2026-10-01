import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { ModelInfo } from '../vite-env'
import { load3mfObject } from '../lib/threemf'

type Props = { model: ModelInfo | null }

export function ModelViewer({ model }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !model) return

    let disposed = false
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0c0e12)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(4, 6, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x38bdf8, 0.4)
    rim.position.set(-4, 2, -3)
    scene.add(rim)

    const grid = new THREE.GridHelper(100, 20, 0x334155, 0x1f2937)
    grid.position.y = -0.001
    scene.add(grid)

    function resize() {
      if (!mountRef.current) return
      const el = mountRef.current
      const w = el.clientWidth
      const h = el.clientHeight
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let frame = 0
    const animate = () => {
      if (disposed) return
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    ;(async () => {
      try {
        const buf = await window.printshelf.readFile(model.path)
        if (disposed) return
        let object: THREE.Object3D
        if (model.ext === 'stl') {
          const geometry = new STLLoader().parse(buf)
          geometry.computeVertexNormals()
          geometry.center()
          object = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x5eead4, metalness: 0.18, roughness: 0.42 }),
          )
        } else {
          object = await load3mfObject(buf)
        }
        if (disposed) return
        scene.add(object)
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        object.position.sub(center)
        const maxDim = Math.max(size.x, size.y, size.z, 1)
        grid.scale.setScalar(Math.max(maxDim / 50, 0.01))
        const dist = maxDim * 2.4
        camera.position.set(dist * 0.8, dist * 0.55, dist)
        camera.near = maxDim / 200
        camera.far = maxDim * 200
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.update()
      } catch (err) {
        console.error('ModelViewer load failed', model.name, err)
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m) => m.dispose())
        }
      })
    }
  }, [model?.id])

  if (!model) {
    return (
      <div className="viewer-empty">
        <div>
          <div style={{ fontSize: 18, color: '#e8edf7', marginBottom: 8 }}>Select a model</div>
          <div>Click any card to preview it in 3D — orbit with the mouse.</div>
        </div>
      </div>
    )
  }

  return <div className="viewer" ref={mountRef} />
}
