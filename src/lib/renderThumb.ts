import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { extract3mfThumbDataUrl, load3mfObject } from './threemf'

const SIZE = 320

async function renderObjectThumb(object: THREE.Object3D): Promise<string> {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1d24)

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000)
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  })
  renderer.setSize(SIZE, SIZE)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(2, 3, 4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x93c5fd, 0.45)
  fill.position.set(-3, 1, -2)
  scene.add(fill)

  scene.add(object)

  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)

  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const dist = maxDim * 2.2
  camera.position.set(dist * 0.75, dist * 0.55, dist)
  camera.lookAt(0, 0, 0)
  camera.near = maxDim / 100
  camera.far = maxDim * 100
  camera.updateProjectionMatrix()

  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  renderer.dispose()
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach((m) => m.dispose())
    }
  })

  return dataUrl
}

export async function renderModelThumb(buffer: ArrayBuffer, ext: string): Promise<string> {
  if (ext === '3mf') {
    const embedded = await extract3mfThumbDataUrl(buffer)
    if (embedded) return embedded
    const object = await load3mfObject(buffer)
    return renderObjectThumb(object)
  }

  const geometry = new STLLoader().parse(buffer)
  geometry.computeVertexNormals()
  geometry.center()
  const material = new THREE.MeshStandardMaterial({
    color: 0x5eead4,
    metalness: 0.15,
    roughness: 0.45,
  })
  const object = new THREE.Mesh(geometry, material)
  return renderObjectThumb(object)
}
