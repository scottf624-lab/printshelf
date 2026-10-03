import JSZip from 'jszip'
import * as THREE from 'three'

const THUMB_CANDIDATES = [
  'Metadata/plate_1.png',
  'Auxiliaries/.thumbnails/thumbnail_middle.png',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png',
  'Auxiliaries/.thumbnails/thumbnail_small.png',
  'Metadata/top_1.png',
]

const PRODUCTION_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'

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

/**
 * Parse a 3MF transform attribute into a Three.js matrix.
 *
 * The spec stores the first three columns of a row-major 4x4
 * (row-vector form): "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32".
 * The last column is fixed at 0 0 0 1, and translation is m30 m31 m32
 * (the last three floats). Identity is "1 0 0 0 1 0 0 0 1 0 0 0".
 * Three.js uses column vectors, so Matrix4.set receives the transpose.
 * Missing or invalid input is identity.
 */
export function parseTransform(transform: string | null | undefined): THREE.Matrix4 {
  const matrix = new THREE.Matrix4()
  if (!transform || !transform.trim()) return matrix
  const parts = transform.trim().split(/\s+/)
  if (parts.length !== 12) return matrix
  const t = parts.map((part) => Number(part))
  if (t.some((n) => !Number.isFinite(n))) return matrix
  matrix.set(
    t[0], t[3], t[6], t[9],
    t[1], t[4], t[7], t[10],
    t[2], t[5], t[8], t[11],
    0, 0, 0, 1,
  )
  return matrix
}

/** Column-vector composition: parent * component * local. */
export function composeTransform(
  parent: THREE.Matrix4,
  component: THREE.Matrix4,
  local: THREE.Matrix4,
): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(parent, component).multiply(local)
}

type ComponentRef = {
  objectId: string
  path: string | null
  transform: THREE.Matrix4
}

type ParsedObject = {
  id: string
  mesh: THREE.BufferGeometry | null
  components: ComponentRef[]
  path: string | null
}

type BuildItem = {
  objectId: string
  path: string | null
  transform: THREE.Matrix4
}

type ParsedModel = {
  objects: Map<string, ParsedObject>
  build: BuildItem[]
}

function localTag(el: Element): string {
  const raw = el.localName || el.tagName || ''
  const colon = raw.indexOf(':')
  return (colon >= 0 ? raw.slice(colon + 1) : raw).toLowerCase()
}

/** Production extension path (p:path), namespace-aware with a prefix fallback. */
function productionPath(el: Element): string | null {
  if (typeof el.getAttributeNS === 'function') {
    const fromNs = el.getAttributeNS(PRODUCTION_NS, 'path')
    if (fromNs) return fromNs
  }
  const plain = el.getAttribute('path')
  if (plain) return plain
  const attrs = el.attributes
  if (!attrs) return null
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    const name = (attr.localName || attr.name || '').toLowerCase()
    if (name === 'path' || name.endsWith(':path')) return attr.value
  }
  return null
}

function directChildren(el: Element, name: string): Element[] {
  const out: Element[] = []
  const children = el.children
  if (!children) return out
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (localTag(child) === name) out.push(child)
  }
  return out
}

function packagePath(path: string): string {
  let value = path.trim().replace(/\\/g, '/')
  try {
    value = decodeURIComponent(value)
  } catch {
    // keep the raw path
  }
  if (value.startsWith('/')) value = value.slice(1)
  const parts: string[] = []
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function parseMeshElement(meshEl: Element): THREE.BufferGeometry | null {
  const vertexNodes = meshEl.getElementsByTagName('vertex')
  const vertexCount = vertexNodes.length
  if (vertexCount === 0) return null
  const positions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const vertex = vertexNodes[i]
    positions[i * 3] = parseFloat(vertex.getAttribute('x') || '0')
    positions[i * 3 + 1] = parseFloat(vertex.getAttribute('y') || '0')
    positions[i * 3 + 2] = parseFloat(vertex.getAttribute('z') || '0')
  }

  const triangleNodes = meshEl.getElementsByTagName('triangle')
  const triangleCount = triangleNodes.length
  if (triangleCount === 0) return null
  const indices = new Uint32Array(triangleCount * 3)
  for (let i = 0; i < triangleCount; i++) {
    const triangle = triangleNodes[i]
    indices[i * 3] = parseInt(triangle.getAttribute('v1') || '0', 10)
    indices[i * 3 + 1] = parseInt(triangle.getAttribute('v2') || '0', 10)
    indices[i * 3 + 2] = parseInt(triangle.getAttribute('v3') || '0', 10)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

function parseModelXml(xml: string): ParsedModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const model: ParsedModel = { objects: new Map(), build: [] }
  const root = doc.documentElement
  if (!root || localTag(root) === 'parsererror') return model

  const resources = directChildren(root, 'resources')[0] ?? root
  for (const objectEl of directChildren(resources, 'object')) {
    const id = objectEl.getAttribute('id')
    if (!id) continue
    const meshEl = directChildren(objectEl, 'mesh')[0]
    const componentsEl = directChildren(objectEl, 'components')[0]
    const components: ComponentRef[] = []
    if (componentsEl) {
      for (const componentEl of directChildren(componentsEl, 'component')) {
        const objectId = componentEl.getAttribute('objectid')
        if (!objectId) continue
        components.push({
          objectId,
          path: productionPath(componentEl),
          transform: parseTransform(componentEl.getAttribute('transform')),
        })
      }
    }
    model.objects.set(id, {
      id,
      mesh: meshEl ? parseMeshElement(meshEl) : null,
      components,
      path: productionPath(objectEl),
    })
  }

  const buildEl = directChildren(root, 'build')[0]
  if (buildEl) {
    for (const itemEl of directChildren(buildEl, 'item')) {
      const objectId = itemEl.getAttribute('objectid')
      if (!objectId) continue
      model.build.push({
        objectId,
        path: productionPath(itemEl),
        transform: parseTransform(itemEl.getAttribute('transform')),
      })
    }
  }
  return model
}

function indexPath(path: string): string {
  return packagePath(path).toLowerCase()
}

function lookupModel(models: Map<string, ParsedModel>, path: string | null): string | null {
  if (!path) return null
  const key = indexPath(path)
  if (models.has(key)) return key
  return null
}

function rootModelKey(models: Map<string, ParsedModel>, relsXml: string | null): string | null {
  const keys = [...models.keys()]
  if (relsXml) {
    const doc = new DOMParser().parseFromString(relsXml, 'application/xml')
    const relationships = doc.getElementsByTagName('Relationship')
    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships[i]
      const type = (rel.getAttribute('Type') || '').toLowerCase()
      const target = rel.getAttribute('Target') || ''
      if (!type.includes('3dmodel') || !target.toLowerCase().endsWith('.model')) continue
      const key = lookupModel(models, target)
      if (key) return key
    }
  }
  return keys.find((key) => /(^|\/)3d\/3dmodel\.model$/i.test(key)) ?? null
}

type Located = { file: string; object: ParsedObject }

function locateObject(
  models: Map<string, ParsedModel>,
  referrerFile: string,
  objectId: string,
  pathHint: string | null,
): Located | null {
  const hinted = pathHint ? lookupModel(models, pathHint) : null
  if (hinted) {
    const hintedObject = models.get(hinted)!.objects.get(objectId)
    if (hintedObject) return { file: hinted, object: hintedObject }
    const only = [...models.get(hinted)!.objects.values()]
    if (only.length === 1) return { file: hinted, object: only[0] }
  }
  const local = models.get(referrerFile)?.objects.get(objectId)
  if (local) return { file: referrerFile, object: local }
  return null
}

/** Load Bambu / standard 3MF meshes, one mesh per object instance with its build transform. */
export async function load3mfObject(buffer: ArrayBuffer): Promise<THREE.Group> {
  const zip = await JSZip.loadAsync(buffer)
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    metalness: 0.12,
    roughness: 0.48,
  })
  const identity = new THREE.Matrix4()
  const models = new Map<string, ParsedModel>()

  const modelPaths = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && /\.model$/i.test(name))
    .sort()

  for (const path of modelPaths) {
    const xml = await zip.file(path)!.async('string')
    if (!/<mesh[\s>]/i.test(xml) && !/<build[\s>]/i.test(xml) && !/<component[\s>]/i.test(xml)) continue
    models.set(indexPath(path), parseModelXml(xml))
  }

  let relsXml: string | null = null
  const relsFile = zip.file('_rels/.rels') || zip.file('_rels/.rels'.toLowerCase())
  if (relsFile) relsXml = await relsFile.async('string')

  const addMesh = (geometry: THREE.BufferGeometry, name: string, matrix: THREE.Matrix4) => {
    const mesh = new THREE.Mesh(geometry, material.clone())
    mesh.name = name
    mesh.matrix.copy(matrix)
    mesh.matrixAutoUpdate = false
    mesh.matrixWorldNeedsUpdate = true
    group.add(mesh)
  }

  const addObject = (
    referrerFile: string,
    objectId: string,
    pathHint: string | null,
    matrix: THREE.Matrix4,
    stack: string[],
  ) => {
    const located = locateObject(models, referrerFile, objectId, pathHint)
    if (!located) return
    const key = `${located.file}|${located.object.id}`
    if (stack.includes(key)) return
    const nextStack = [...stack, key]
    const obj = located.object

    if (obj.components.length > 0) {
      for (const component of obj.components) {
        addObject(
          located.file,
          component.objectId,
          component.path,
          composeTransform(matrix, component.transform, identity),
          nextStack,
        )
      }
      return
    }

    if (obj.path && !obj.mesh) {
      addObject(located.file, obj.id, obj.path, matrix, nextStack)
      return
    }

    if (obj.mesh) addMesh(obj.mesh, `${located.file}#${obj.id}`, matrix)
  }

  const root = rootModelKey(models, relsXml)
  const rootBuild = root ? models.get(root)!.build : []
  if (rootBuild.length > 0 && root) {
    for (const item of rootBuild) {
      addObject(root, item.objectId, item.path, item.transform, [])
    }
  } else {
    const otherBuilds = [...models.entries()].filter(([, model]) => model.build.length > 0)
    if (otherBuilds.length > 0) {
      for (const [file, model] of otherBuilds) {
        for (const item of model.build) {
          addObject(file, item.objectId, item.path, item.transform, [])
        }
      }
    } else {
      // No build graph. Keep each mesh object separate instead of concatenating vertices.
      for (const [file, model] of models) {
        for (const obj of model.objects.values()) {
          if (!obj.mesh) continue
          addMesh(obj.mesh, `${file}#${obj.id}`, identity)
        }
      }
    }
  }

  if (group.children.length === 0) {
    throw new Error('No mesh data found in 3MF')
  }
  return group
}
