import JSZip from 'jszip'
import * as THREE from 'three'

const THUMB_CANDIDATES = [
  'Metadata/plate_1.png',
  'Auxiliaries/.thumbnails/thumbnail_middle.png',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png',
  'Auxiliaries/.thumbnails/thumbnail_small.png',
  'Metadata/top_1.png',
]

function textDecoder() {
  return new TextDecoder('utf-8')
}

export async function extract3mfThumbDataUrl(buffer: ArrayBuffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer)
  for (const path of THUMB_CANDIDATES) {
    const file = zip.file(path)
    if (!file) continue
    const bytes = await file.async('uint8array')
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:image/png;base64,${btoa(binary)}`
  }
  // any png under Metadata or thumbnails
  const fallback = Object.keys(zip.files).find(
    (n) =>
      !zip.files[n].dir &&
      /\.png$/i.test(n) &&
      (/thumbnail/i.test(n) || /plate_/i.test(n) || /^Metadata\//.test(n)),
  )
  if (!fallback) return null
  const bytes = await zip.file(fallback)!.async('uint8array')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

function parseMeshFromModelXml(xml: string): THREE.BufferGeometry | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const vertexEls = [...doc.getElementsByTagName('vertex')]
  if (vertexEls.length === 0) return null
  const positions = new Float32Array(vertexEls.length * 3)
  vertexEls.forEach((v, i) => {
    positions[i * 3] = parseFloat(v.getAttribute('x') || '0')
    positions[i * 3 + 1] = parseFloat(v.getAttribute('y') || '0')
    positions[i * 3 + 2] = parseFloat(v.getAttribute('z') || '0')
  })

  const triEls = [...doc.getElementsByTagName('triangle')]
  if (triEls.length === 0) return null
  const indices = new Uint32Array(triEls.length * 3)
  triEls.forEach((t, i) => {
    indices[i * 3] = parseInt(t.getAttribute('v1') || '0', 10)
    indices[i * 3 + 1] = parseInt(t.getAttribute('v2') || '0', 10)
    indices[i * 3 + 2] = parseInt(t.getAttribute('v3') || '0', 10)
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/** Load Bambu / standard 3MF meshes from Objects/*.model (and root model if meshed). */
export async function load3mfObject(buffer: ArrayBuffer): Promise<THREE.Group> {
  const zip = await JSZip.loadAsync(buffer)
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    metalness: 0.12,
    roughness: 0.48,
  })

  const modelPaths = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && /\.model$/i.test(n))
    .sort()

  for (const path of modelPaths) {
    const xml = await zip.file(path)!.async('string')
    // Prefer files that actually contain <mesh>
    if (!/<mesh[\s>]/i.test(xml)) continue
    const geometry = parseMeshFromModelXml(xml)
    if (!geometry) continue
    const mesh = new THREE.Mesh(geometry, material.clone())
    mesh.name = path
    group.add(mesh)
  }

  if (group.children.length === 0) {
    throw new Error('No mesh data found in 3MF')
  }
  return group
}
