const DB_NAME = 'atelier-habitacion'
const DB_VERSION = 1

export interface WorkRecord {
  id: string
  token: number
  name: string
  createdAt: number
  blob: Blob
}

export interface PhotoRecord {
  id: string
  name: string
  createdAt: number
  blob: Blob
}

export type FrameSlot = { kind: 'work'; id: string } | { kind: 'photo'; id: string } | null

export interface TrackRecord {
  videoId: string
  title: string
}

const EMPTY_FRAMES: FrameSlot[] = [null, null, null]

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listWorks() {
  const db = await openDb()
  const tx = db.transaction('works', 'readonly')
  const rows = await requestToPromise(tx.objectStore('works').getAll() as IDBRequest<WorkRecord[]>)
  await txDone(tx)
  db.close()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function upsertWork(input: { token: number; name: string; blob: Blob }) {
  const db = await openDb()
  const tx = db.transaction('works', 'readwrite')
  const store = tx.objectStore('works')
  const rows = await requestToPromise(store.getAll() as IDBRequest<WorkRecord[]>)
  const existing = rows.find((row) => row.token === input.token)
  const record: WorkRecord = existing
    ? { ...existing, name: input.name, blob: input.blob, createdAt: Date.now() }
    : { id: crypto.randomUUID(), token: input.token, name: input.name, blob: input.blob, createdAt: Date.now() }
  store.put(record)
  await txDone(tx)
  db.close()
  return existing ? 'updated' : 'created'
}

export async function deleteWork(id: string) {
  const db = await openDb()
  const tx = db.transaction(['works', 'meta'], 'readwrite')
  tx.objectStore('works').delete(id)
  const frames = ((await requestToPromise(tx.objectStore('meta').get('frames'))) as FrameSlot[] | undefined) ?? EMPTY_FRAMES
  tx.objectStore('meta').put(
    frames.map((slot) => (slot?.kind === 'work' && slot.id === id ? null : slot)),
    'frames',
  )
  await txDone(tx)
  db.close()
}

export async function savePhoto(file: File) {
  const bitmap = await createImageBitmap(file)
  const maxSide = 1200
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo guardar la foto')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('No se pudo guardar la foto'))), 'image/jpeg', 0.86)
  })
  const record: PhotoRecord = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '') || 'Foto', createdAt: Date.now(), blob }
  const db = await openDb()
  const tx = db.transaction('photos', 'readwrite')
  tx.objectStore('photos').put(record)
  await txDone(tx)
  db.close()
  return record
}

export async function listPhotos() {
  const db = await openDb()
  const tx = db.transaction('photos', 'readonly')
  const rows = await requestToPromise(tx.objectStore('photos').getAll() as IDBRequest<PhotoRecord[]>)
  await txDone(tx)
  db.close()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getWork(id: string) {
  const db = await openDb()
  const tx = db.transaction('works', 'readonly')
  const row = await requestToPromise(tx.objectStore('works').get(id) as IDBRequest<WorkRecord | undefined>)
  await txDone(tx)
  db.close()
  return row
}

export async function getPhoto(id: string) {
  const db = await openDb()
  const tx = db.transaction('photos', 'readonly')
  const row = await requestToPromise(tx.objectStore('photos').get(id) as IDBRequest<PhotoRecord | undefined>)
  await txDone(tx)
  db.close()
  return row
}

export async function loadFrames() {
  const db = await openDb()
  const tx = db.transaction('meta', 'readonly')
  const frames = (await requestToPromise(tx.objectStore('meta').get('frames'))) as FrameSlot[] | undefined
  await txDone(tx)
  db.close()
  const slots = frames && frames.length === 3 ? frames : [...EMPTY_FRAMES]
  return slots
}

export async function saveFrames(frames: FrameSlot[]) {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(frames, 'frames')
  await txDone(tx)
  db.close()
}

export async function loadTracks() {
  const db = await openDb()
  const tx = db.transaction('meta', 'readonly')
  const tracks = (await requestToPromise(tx.objectStore('meta').get('tracks'))) as TrackRecord[] | undefined
  await txDone(tx)
  db.close()
  return tracks ?? []
}

export async function saveTracks(tracks: TrackRecord[]) {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(tracks, 'tracks')
  await txDone(tx)
  db.close()
}
