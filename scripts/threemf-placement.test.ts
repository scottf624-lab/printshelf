import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import JSZip from 'jszip'
import { DOMParser } from 'linkedom'
import { composeTransform, load3mfObject, parseTransform } from '../src/lib/threemf.ts'

globalThis.DOMParser = DOMParser

function nearly(a: number, b: number, eps = 1e-4) {
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`)
}

function vecNear(v: THREE.Vector3, x: number, y: number, z: number, eps = 1e-4) {
  nearly(v.x, x, eps)
  nearly(v.y, y, eps)
  nearly(v.z, z, eps)
}

function meshCenters(root: THREE.Object3D) {
  const centers: { name: string; center: THREE.Vector3; translation: THREE.Vector3 }[] = []
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const box = new THREE.Box3().setFromObject(mesh)
    const translation = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld)
    centers.push({ name: mesh.name, center: box.getCenter(new THREE.Vector3()), translation })
  })
  return centers
}

async function toArrayBuffer(zip: JSZip) {
  return zip.generateAsync({ type: 'arraybuffer' })
}

function cubeModel(id: string, ox = 0, oy = 0, oz = 0) {
  const verts = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
    .map(([x, y, z]) => `<vertex x="${x + ox}" y="${y + oy}" z="${z + oz}"/>`)
    .join('')
  const tris = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1],
    [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3],
    [3, 7, 4], [3, 4, 0],
  ]
    .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources>
  <object id="${id}" type="model">
   <mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh>
  </object>
 </resources>
 <build/>
</model>`
}

{
  const identity = parseTransform('1 0 0 0 1 0 0 0 1 0 0 0')
  assert.ok(new THREE.Matrix4().equals(identity), 'spec identity string must be Matrix4 identity')
  const moved = parseTransform('1 0 0 0 1 0 0 0 1 10 20 30')
  vecNear(new THREE.Vector3(0, 0, 0).applyMatrix4(moved), 10, 20, 30)
  assert.ok(new THREE.Matrix4().equals(parseTransform(null)), 'missing transform is identity')
  assert.ok(new THREE.Matrix4().equals(parseTransform('1 0 0')), 'short transform is identity')

  const parent = parseTransform('1 0 0 0 1 0 0 0 1 10 20 30')
  const component = parseTransform('1 0 0 0 1 0 0 0 1 1 2 3')
  const local = parseTransform('1 0 0 0 1 0 0 0 1 4 0 0')
  const composed = composeTransform(parent, component, local)
  vecNear(new THREE.Vector3(0, 0, 0).applyMatrix4(composed), 15, 22, 33)
  console.log('matrix: identity, translation, and parent*component*local ok')
}

{
  const zip = new JSZip()
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources>
  <object id="10" type="model">
   <components>
    <component p:path="/3D/Objects/object_a.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/>
   </components>
  </object>
  <object id="11" type="model">
   <components>
    <component p:path="/3D/Objects/object_b.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 2 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="10" transform="1 0 0 0 1 0 0 0 1 10 20 30"/>
  <item objectid="11" transform="1 0 0 0 1 0 0 0 1 0 0 5"/>
 </build>
</model>`)
  zip.file('3D/Objects/object_a.model', cubeModel('1'))
  zip.file('3D/Objects/object_b.model', cubeModel('2'))
  const group = await load3mfObject(await toArrayBuffer(zip))
  const centers = meshCenters(group)
  assert.equal(centers.length, 2, 'build graph must not also draw the raw child meshes')
  const byName = Object.fromEntries(centers.map((entry) => [entry.name, entry.center]))
  // cube center is (0.5,0.5,0.5); build * component shifts it
  vecNear(byName['3d/objects/object_a.model#1'], 11.5, 20.5, 30.5)
  vecNear(byName['3d/objects/object_b.model#2'], 0.5, 2.5, 5.5)
  const same = centers.every((entry) => entry.center.distanceTo(centers[0].center) < 1e-6)
  assert.equal(same, false)
  console.log('synthetic component+build cubes', centers.map((c) => [c.name, c.center.toArray()]))
}

{
  const zip = new JSZip()
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`)
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources>
  <object id="2" p:path="/3D/Objects/object_2.model"/>
 </resources>
 <build>
  <item objectid="2" p:path="/3D/Objects/object_2.model" transform="1 0 0 0 1 0 0 0 1 4 0 0"/>
 </build>
</model>`)
  zip.file('3D/Objects/object_2.model', cubeModel('2'))
  const centers = meshCenters(await load3mfObject(await toArrayBuffer(zip)))
  assert.equal(centers.length, 1)
  vecNear(centers[0].center, 4.5, 0.5, 0.5)
  console.log('synthetic production path item', centers[0].center.toArray())
}

{
  const zip = new JSZip()
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="1" y="1" z="0"/><vertex x="0" y="1" z="0"/>
     <vertex x="0" y="0" z="1"/><vertex x="1" y="0" z="1"/><vertex x="1" y="1" z="1"/><vertex x="0" y="1" z="1"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/>
     <triangle v1="4" v2="6" v3="5"/><triangle v1="4" v2="7" v3="6"/>
     <triangle v1="0" v2="4" v3="5"/><triangle v1="0" v2="5" v3="1"/>
     <triangle v1="1" v2="5" v3="6"/><triangle v1="1" v2="6" v3="2"/>
     <triangle v1="2" v2="6" v3="7"/><triangle v1="2" v2="7" v3="3"/>
     <triangle v1="3" v2="7" v3="4"/><triangle v1="3" v2="4" v3="0"/>
    </triangles>
   </mesh>
  </object>
  <object id="2" type="model">
   <mesh>
    <vertices>
     <vertex x="5" y="0" z="0"/><vertex x="6" y="0" z="0"/><vertex x="6" y="1" z="0"/><vertex x="5" y="1" z="0"/>
     <vertex x="5" y="0" z="1"/><vertex x="6" y="0" z="1"/><vertex x="6" y="1" z="1"/><vertex x="5" y="1" z="1"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/>
     <triangle v1="4" v2="6" v3="5"/><triangle v1="4" v2="7" v3="6"/>
     <triangle v1="0" v2="4" v3="5"/><triangle v1="0" v2="5" v3="1"/>
     <triangle v1="1" v2="5" v3="6"/><triangle v1="1" v2="6" v3="2"/>
     <triangle v1="2" v2="6" v3="7"/><triangle v1="2" v2="7" v3="3"/>
     <triangle v1="3" v2="7" v3="4"/><triangle v1="3" v2="4" v3="0"/>
    </triangles>
   </mesh>
  </object>
 </resources>
</model>`)
  const group = await load3mfObject(await toArrayBuffer(zip))
  const centers = meshCenters(group)
  assert.equal(centers.length, 2, 'no build graph must not concatenate objects into one mesh')
  const xs = centers.map((entry) => entry.center.x).sort((a, b) => a - b)
  nearly(xs[0], 0.5)
  nearly(xs[1], 5.5)
  console.log('synthetic no-build separate objects', centers.map((c) => c.center.toArray()))
}

const realPath = '/Volumes/Crucial X9/3D Prints/160x140.3mf'
if (fs.existsSync(realPath)) {
  const buf = fs.readFileSync(realPath)
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const group = await load3mfObject(arrayBuffer)
  const centers = meshCenters(group)
  assert.ok(centers.length > 1, `expected multiple meshes, got ${centers.length}`)
  const unique = new Set(centers.map((entry) => entry.center.toArray().map((n) => n.toFixed(3)).join(',')))
  assert.ok(unique.size > 1, `all centers were identical: ${[...unique].join(' | ')}`)
  const translated = centers.find((entry) => Math.abs(entry.translation.x - 89.99999) < 1e-2 && Math.abs(entry.translation.y - 90) < 1e-2)
  assert.ok(translated, `missing build translation (90, 90, 2.5); translations=${centers.map((c) => c.translation.toArray())}`)
  console.log('real file', realPath)
  console.log('mesh count', centers.length)
  for (const entry of centers) {
    console.log(entry.name, 'center', entry.center.toArray(), 'translation', entry.translation.toArray())
  }
} else {
  console.log('real volume file not mounted, skipped')
}

console.log('all 3mf placement checks passed')
