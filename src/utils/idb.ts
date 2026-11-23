import type { ProjectData, RegionInfo, Rgb } from '../types.ts'

const DB_NAME = 'atelier-pintar'
const STORE = 'projects'
const KEY = 'current'

export interface ProjectSave {
  version: 1
  shareId?: string
  name: string
  width: number
  height: number
  colorCount: number
  minRegion: number
  palette: Rgb[]
  regions: RegionInfo[]
  regionMap: ArrayBuffer
  pixelOffsets: ArrayBuffer
  pixelIndices: ArrayBuffer
  edges: ArrayBuffer
  original: ArrayBuffer
  painted: ArrayBuffer
  activeColor: number
  savedAt: number
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveProject(record: ProjectSave) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadProject() {
  const db = await openDb()
  const record = await new Promise<ProjectSave | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve(request.result as ProjectSave | undefined)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return record
}

export async function clearProject() {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export function projectToSave(project: ProjectData, painted: Uint8Array, activeColor: number): ProjectSave {
  return {
    version: 1,
    shareId: project.shareId,
    name: project.name,
    width: project.width,
    height: project.height,
    colorCount: project.colorCount,
    minRegion: project.minRegion,
    palette: project.palette,
    regions: project.regions,
    regionMap: project.regionMap.buffer as ArrayBuffer,
    pixelOffsets: project.pixelOffsets.buffer as ArrayBuffer,
    pixelIndices: project.pixelIndices.buffer as ArrayBuffer,
    edges: project.edges.buffer as ArrayBuffer,
    original: project.original.buffer as ArrayBuffer,
    painted: painted.buffer as ArrayBuffer,
    activeColor,
    savedAt: Date.now(),
  }
}
