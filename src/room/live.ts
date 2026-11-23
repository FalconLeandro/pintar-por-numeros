import { create } from 'zustand'
import { onSharedImage } from './events.ts'
import { adoptSharedProject, applyRemoteMask, isStrokeActive, onPaintSettled, usePaintStore } from '../store/usePaintStore.ts'
import { useRoomStore } from '../store/useRoomStore.ts'
import { cacheSharedRecord, listPhotos, listWorks, loadFrames, saveFrames, type FrameSlot } from '../utils/roomDb.ts'
import type { ProjectData } from '../types.ts'

const OWNER_KEY = 'atelier-owner'
const GUEST_KEY = 'atelier-guest'
const CLIENT_KEY = 'atelier-client'

export type LiveRole = 'owner' | 'guest'

interface Playback {
  videoId: string | null
  playing: boolean
  startedAt: number
  position: number
}

interface SharedImage {
  id: string
  kind: 'work' | 'photo'
  name: string
  percent: number
  updated_at: string | number
}

interface LiveStore {
  ready: boolean
  admitted: boolean
  exists: boolean
  role: LiveRole | null
  error: string | null
  ownerOnline: boolean
  guestOnline: boolean
  crossword: Record<string, string> | null
  followNonce: number
  boot: () => Promise<void>
  createRoom: (keyword: string) => Promise<void>
  enter: (keyword: string) => Promise<void>
  changeKeyword: (keyword: string) => Promise<void>
  setCrossword: (letters: Record<string, string>) => void
}

let clientId = localStorage.getItem(CLIENT_KEY)
if (!clientId) {
  clientId = crypto.randomUUID()
  localStorage.setItem(CLIENT_KEY, clientId)
}

let clockOffset = 0
let suppress = 0
let following = false
let pushTimer = 0
let pending: Record<string, unknown> = {}
let lastMask = ''
let stopPaint = () => {}
let stopRoom = () => {}
let pollTimer = 0

export const useLiveStore = create<LiveStore>((set, get) => ({
  ready: false,
  admitted: false,
  exists: false,
  role: null,
  error: null,
  ownerOnline: false,
  guestOnline: false,
  crossword: null,
  followNonce: 0,
  boot: async () => {
    try {
      const status = await call({ action: 'status' })
      const ownerToken = localStorage.getItem(OWNER_KEY)
      if (ownerToken) {
        try {
          await call({ action: 'enter', ownerToken })
          set({ ready: true, admitted: true, exists: true, role: 'owner', error: null })
          await startSync()
          return
        } catch {
          localStorage.removeItem(OWNER_KEY)
        }
      }
      const guest = localStorage.getItem(GUEST_KEY)
      if (guest && status.exists) {
        try {
          await call({ action: 'pull' }, guest)
          set({ ready: true, admitted: true, exists: true, role: 'guest', error: null })
          await startSync()
          return
        } catch {
          localStorage.removeItem(GUEST_KEY)
        }
      }
      set({ ready: true, admitted: false, exists: Boolean(status.exists), role: null })
    } catch (error) {
      set({ ready: true, error: messageOf(error) })
    }
  },
  createRoom: async (keyword) => {
    const ownerToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    await call({ action: 'create', keyword, ownerToken })
    localStorage.setItem(OWNER_KEY, ownerToken)
    set({ admitted: true, exists: true, role: 'owner', error: null })
    await startSync()
  },
  enter: async (keyword) => {
    const result = await call({ action: 'enter', keyword })
    if (result.role === 'guest' && result.token) localStorage.setItem(GUEST_KEY, String(result.token))
    set({ admitted: true, exists: true, role: result.role === 'owner' ? 'owner' : 'guest', error: null })
    await startSync()
  },
  changeKeyword: async (keyword) => {
    await call({ action: 'keyword', keyword })
  },
  setCrossword: (letters) => {
    set({ crossword: letters })
    if (suppress || !get().admitted) return
    queue({ crossword: letters })
  },
}))

function authToken() {
  if (useLiveStore.getState().role === 'guest') return localStorage.getItem(GUEST_KEY)
  return localStorage.getItem(OWNER_KEY)
}

async function call(body: Record<string, unknown>, token = authToken()) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch('/api/room', { method: 'POST', headers, body: JSON.stringify({ ...body, clientId }) })
  const data = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    if (response.status === 401 && useLiveStore.getState().admitted) {
      localStorage.removeItem(GUEST_KEY)
      useLiveStore.setState({ admitted: false, role: null, error: 'La palabra cambió. Volvé a entrar.' })
    }
    throw new Error(typeof data.error === 'string' ? data.error : 'No pude hablar con la habitación')
  }
  return data
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'No pude hablar con la habitación'
}

function queue(patch: Record<string, unknown>) {
  pending = { ...pending, ...patch }
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => void flush(), 350)
}

async function flush() {
  const patch = pending
  pending = {}
  if (!Object.keys(patch).length || !useLiveStore.getState().admitted) return
  try {
    await call({ action: 'push', patch })
  } catch (error) {
    useLiveStore.setState({ error: messageOf(error) })
  }
}

let syncStarted = false

async function startSync() {
  if (syncStarted) return
  syncStarted = true
  window.clearInterval(pollTimer)
  stopPaint()
  stopRoom()
  try {
    await pull(true)
  } catch (error) {
    syncStarted = false
    throw error
  }
  stopRoom = useRoomStore.subscribe((state, previous) => {
    if (suppress || following || !useLiveStore.getState().admitted) return
    if (state.tracks !== previous.tracks) queue({ tracks: state.tracks })
    if (
      state.currentId !== previous.currentId ||
      state.playing !== previous.playing ||
      state.position !== previous.position ||
      state.startedAt !== previous.startedAt
    ) {
      queue({
        playback: { videoId: state.currentId, playing: state.playing, position: state.position, startedAt: state.startedAt },
      })
    }
  })
  stopPaint = onPaintSettled(() => void sharePaint())
  onSharedImage((image) => void publishImage(image.kind, image.id, image.name, image.percent, image.blob))
  pollTimer = window.setInterval(() => void pull(false), 1000)
}

async function pull(seed: boolean) {
  const data = await call({ action: 'pull' })
  clockOffset = Number(data.serverNow) - Date.now()
  const body = data.body as {
    playback: Playback
    tracks: { videoId: string; title: string }[]
    frames: FrameSlot[]
    crossword: Record<string, string>
    paint: { shareId: string; name: string; percent: number; mask: string; ready: boolean } | null
  }
  useLiveStore.setState({
    ownerOnline: Boolean(data.ownerOnline),
    guestOnline: Boolean(data.guestOnline),
    error: null,
  })
  const local = useRoomStore.getState()
  if (seed && body.tracks.length === 0 && local.tracks.length > 0) queue({ tracks: local.tracks, playback: playbackFromStore() })
  else applyPlayback(body.playback, body.tracks, String(data.updatedBy ?? ''))
  if (seed && Object.keys(body.crossword).length === 0) {
    const saved = localCrossword()
    if (Object.keys(saved).length) queue({ crossword: saved })
    else useLiveStore.setState({ crossword: {} })
  } else if (JSON.stringify(body.crossword) !== JSON.stringify(useLiveStore.getState().crossword)) {
    suppress += 1
    useLiveStore.setState({ crossword: body.crossword })
    suppress -= 1
  }
  if (seed && body.frames.every((slot) => !slot)) {
    const frames = await loadFrames()
    if (frames.some(Boolean)) queue({ frames })
  } else await applyFrames(body.frames)
  const images = (data.images as SharedImage[]) ?? []
  await applyImages(images)
  if (seed) await seedLocalImages(images)
  await applyPaint(body.paint, seed)
}

async function seedLocalImages(images: SharedImage[]) {
  const known = new Set(images.map((image) => image.id))
  for (const work of await listWorks()) {
    if (!known.has(work.id)) await publishImage('work', work.id, work.name, work.percent ?? 100, work.blob)
  }
  for (const photo of await listPhotos()) {
    if (!known.has(photo.id)) await publishImage('photo', photo.id, photo.name, 100, photo.blob)
  }
}

function playbackFromStore(): Playback {
  const state = useRoomStore.getState()
  return { videoId: state.currentId, playing: state.playing, startedAt: state.startedAt, position: state.position }
}

function applyPlayback(playback: Playback, tracks: { videoId: string; title: string }[], updatedBy: string) {
  const state = useRoomStore.getState()
  const sameTracks = JSON.stringify(tracks) === JSON.stringify(state.tracks)
  const samePlay = state.currentId === playback.videoId && state.playing === playback.playing
  if (sameTracks && samePlay && updatedBy === clientId) return
  suppress += 1
  useRoomStore.setState({
    tracks,
    currentId: playback.videoId,
    playing: playback.playing,
    startedAt: playback.startedAt,
    position: playback.position,
  })
  suppress -= 1
  if (!samePlay || playback.videoId !== state.currentId) useLiveStore.setState((current) => ({ followNonce: current.followNonce + 1 }))
}

async function applyFrames(frames: FrameSlot[]) {
  const current = await loadFrames()
  if (JSON.stringify(current) === JSON.stringify(frames)) return
  await saveFrames(frames)
  useRoomStore.getState().bumpFrames()
}

const imageStamps = new Map<string, number>()

async function applyImages(images: SharedImage[]) {
  let changed = false
  for (const image of images) {
    const stamp = Number(image.updated_at)
    if (imageStamps.get(image.id) === stamp) continue
    const row = await call({ action: 'image-get', id: image.id })
    const blob = await (await fetch(String(row.image))).blob()
    await cacheSharedRecord(image.kind, image.id, String(row.name), Number(row.percent) || 0, blob)
    imageStamps.set(image.id, stamp)
    changed = true
  }
  if (changed) {
    useRoomStore.getState().bumpWorks()
    useRoomStore.getState().bumpFrames()
  }
}

async function applyPaint(paint: { shareId: string; name: string; percent: number; mask: string; ready: boolean } | null, seed: boolean) {
  if (!paint) return
  const local = usePaintStore.getState().project
  if (!local) {
    if (paint.ready) await downloadProject(paint)
    return
  }
  if (local.shareId !== paint.shareId) {
    if (seed) await uploadProject(local)
    else if (paint.ready) await downloadProject(paint)
    return
  }
  if (isStrokeActive()) return
  const mask = base64ToBytes(paint.mask)
  if (mask.length === usePaintStore.getState().painted?.length) applyRemoteMask(mask)
}

async function sharePaint() {
  if (suppress || !useLiveStore.getState().admitted) return
  const { project, painted, globalFilled } = usePaintStore.getState()
  if (!project || !painted) return
  const mask = bytesToBase64(painted)
  if (mask === lastMask) return
  const previous = lastMask ? base64ToBytes(lastMask) : null
  lastMask = mask
  const percent = project.pixelCount > 0 ? Math.round((globalFilled / project.pixelCount) * 100) : 0
  if (!previous || previous.length !== painted.length) {
    queue({ paint: { shareId: project.shareId, name: project.name, percent, mask } })
    void uploadProject(project)
    return
  }
  const ids: number[] = []
  let removed = false
  for (let index = 1; index < painted.length; index += 1) {
    if (painted[index] && !previous[index]) ids.push(index)
    if (!painted[index] && previous[index]) removed = true
  }
  if (removed) queue({ paint: { shareId: project.shareId, name: project.name, percent, mask } })
  else if (ids.length) queue({ paint: { shareId: project.shareId, name: project.name, percent, ids } })
}

const uploaded = new Set<string>()

async function uploadProject(project: ProjectData) {
  if (uploaded.has(project.shareId)) return
  uploaded.add(project.shareId)
  const parts: Record<string, Uint8Array | Uint8ClampedArray> = {
    regionMap: new Uint8Array(project.regionMap.buffer, project.regionMap.byteOffset, project.regionMap.byteLength),
    pixelOffsets: new Uint8Array(project.pixelOffsets.buffer, project.pixelOffsets.byteOffset, project.pixelOffsets.byteLength),
    pixelIndices: new Uint8Array(project.pixelIndices.buffer, project.pixelIndices.byteOffset, project.pixelIndices.byteLength),
    edges: project.edges,
    original: project.original,
  }
  const meta = bytesToBase64(new TextEncoder().encode(JSON.stringify({
    name: project.name,
    width: project.width,
    height: project.height,
    colorCount: project.colorCount,
    minRegion: project.minRegion,
    palette: project.palette,
    regions: project.regions,
    totals: project.totals,
    pixelCount: project.pixelCount,
  })))
  await sendPart(project.shareId, 'meta', meta)
  for (const [part, buffer] of Object.entries(parts)) await sendPart(project.shareId, part, bytesToBase64(buffer))
  await call({ action: 'geometry-ready', shareId: project.shareId })
}

async function sendPart(shareId: string, part: string, data: string) {
  const size = 300_000
  const total = Math.max(1, Math.ceil(data.length / size))
  for (let seq = 0; seq < total; seq += 1) {
    await call({ action: 'geometry', shareId, part, seq, total, data: data.slice(seq * size, (seq + 1) * size) })
  }
}

async function downloadProject(paint: { shareId: string; name: string; mask: string }) {
  const meta = JSON.parse(new TextDecoder().decode(base64ToBytes(await loadPart(paint.shareId, 'meta')))) as Omit<ProjectData, 'token' | 'shareId' | 'regionMap' | 'pixelOffsets' | 'pixelIndices' | 'edges' | 'original'>
  const regionMap = new Uint32Array(base64ToBytes(await loadPart(paint.shareId, 'regionMap')).buffer)
  const pixelOffsets = new Uint32Array(base64ToBytes(await loadPart(paint.shareId, 'pixelOffsets')).buffer)
  const pixelIndices = new Uint32Array(base64ToBytes(await loadPart(paint.shareId, 'pixelIndices')).buffer)
  const edges = base64ToBytes(await loadPart(paint.shareId, 'edges'))
  const original = new Uint8ClampedArray(base64ToBytes(await loadPart(paint.shareId, 'original')).buffer)
  const project: ProjectData = { ...meta, token: 1, shareId: paint.shareId, regionMap, pixelOffsets, pixelIndices, edges, original }
  suppress += 1
  adoptSharedProject(project, base64ToBytes(paint.mask))
  lastMask = paint.mask
  suppress -= 1
}

async function loadPart(shareId: string, part: string) {
  const result = await call({ action: 'geometry-get', shareId, part })
  const chunks = (result.chunks as { data: string }[]) ?? []
  return chunks.map((chunk) => chunk.data).join('')
}

function localCrossword() {
  try {
    const raw = localStorage.getItem('atelier-crucigrama')
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function notePlayback(position: number) {
  useRoomStore.getState().setTransport({ position })
}

export function remotePlayback() {
  const state = useRoomStore.getState()
  const expected = state.playing ? Math.max(0, (Date.now() + clockOffset - state.startedAt) / 1000) : state.position
  return { videoId: state.currentId, playing: state.playing, expected }
}

export function beginRemoteFollow() {
  following = true
  window.setTimeout(() => {
    following = false
  }, 1200)
}

export async function publishFrames() {
  if (!useLiveStore.getState().admitted) return
  queue({ frames: await loadFrames() })
}

export async function publishImage(kind: 'work' | 'photo', id: string, name: string, percent: number, blob: Blob) {
  if (!useLiveStore.getState().admitted) return
  const image = await blobToDataUrl(blob)
  await call({ action: 'image-put', id, kind, name, percent, image })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x4000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
