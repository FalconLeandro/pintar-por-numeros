import { create } from 'zustand'
import { onSharedImage } from './events.ts'
import { adoptSharedProject, applyRemoteMask, isStrokeActive, onPaintSettled, usePaintStore } from '../store/usePaintStore.ts'
import { useRoomStore } from '../store/useRoomStore.ts'
import {
  cacheSharedRecord,
  legacyRoomId,
  listPhotos,
  listWorks,
  loadFrames,
  loadTracks,
  markLegacyRoom,
  saveFrames,
  setRoomScope,
  type FrameSlot,
} from '../utils/roomDb.ts'
import type { ProjectData } from '../types.ts'

const OWNER_KEY = 'atelier-owner'
const GUEST_KEY = 'atelier-guest'
const CLIENT_KEY = 'atelier-client'
const ROOMS_KEY = 'atelier-rooms'
const CURRENT_KEY = 'atelier-current'

export type LiveRole = 'owner' | 'guest'
export type DoorMode = 'create' | 'enter'

export interface Membership {
  id: string
  role: LiveRole
  token: string
  name: string
}

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
  role: LiveRole | null
  error: string | null
  ownerOnline: boolean
  guestOnline: boolean
  crossword: Record<string, string> | null
  followNonce: number
  roomId: string | null
  roomName: string
  memberships: Membership[]
  mode: DoorMode
  pendingCode: string
  boot: () => Promise<void>
  createRoom: (keyword: string, name: string) => Promise<void>
  enter: (keyword: string, code: string) => Promise<void>
  changeKeyword: (keyword: string) => Promise<void>
  renameRoom: (name: string) => Promise<void>
  openRoom: (roomId: string) => Promise<void>
  showCreate: () => void
  showEnter: () => void
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
let roomPaintId: string | null = null
let allowSeed = false
let stopPaint = () => {}
let stopImage = () => {}
let stopRoom = () => {}
let pollTimer = 0
let syncStarted = false
let booting: Promise<void> | null = null

export const useLiveStore = create<LiveStore>((set, get) => ({
  ready: false,
  admitted: false,
  role: null,
  error: null,
  ownerOnline: false,
  guestOnline: false,
  crossword: null,
  followNonce: 0,
  roomId: null,
  roomName: '',
  memberships: loadMemberships(),
  mode: 'create',
  pendingCode: '',
  boot: () => {
    if (booting) return booting
    booting = runBoot().finally(() => {
      booting = null
    })
    return booting
  },
  createRoom: async (keyword, name) => {
    const ownerToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const result = await call({ action: 'create', keyword, name, ownerToken })
    const member: Membership = {
      id: String(result.roomId),
      role: 'owner',
      token: ownerToken,
      name: String(result.name ?? 'Mi habitación'),
    }
    upsertMembership(member)
    await openMembership(member, false)
  },
  enter: async (keyword, code) => {
    const owned = loadMemberships().find((item) => item.id === code && item.role === 'owner')
    if (owned) {
      await openMembership(owned, owned.id === legacyRoomId())
      return
    }
    const result = await call({ action: 'enter', keyword, roomId: code })
    const member: Membership = {
      id: code,
      role: result.role === 'owner' ? 'owner' : 'guest',
      token: result.role === 'guest' ? String(result.token) : localOwnerToken(code),
      name: String(result.name ?? 'Mi habitación'),
    }
    if (!member.token) throw new Error('No pude abrir la puerta')
    upsertMembership(member)
    await openMembership(member, false)
  },
  changeKeyword: async (keyword) => {
    await call({ action: 'keyword', keyword })
  },
  renameRoom: async (name) => {
    const result = await call({ action: 'rename', name })
    const roomId = get().roomId
    const next = String(result.name ?? 'Mi habitación')
    if (!roomId) return
    const rows = loadMemberships().map((item) => (item.id === roomId ? { ...item, name: next } : item))
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rows))
    set({ roomName: next, memberships: rows })
  },
  openRoom: async (roomId) => {
    const member = loadMemberships().find((item) => item.id === roomId)
    if (!member) throw new Error('No encontré esa habitación.')
    await openMembership(member, member.role === 'owner' && member.id === legacyRoomId())
  },
  showCreate: () => {
    stopSync()
    clearSala()
    useRoomStore.getState().go('room')
    set({ admitted: false, role: null, mode: 'create', pendingCode: '', error: null })
  },
  showEnter: () => {
    stopSync()
    clearSala()
    useRoomStore.getState().go('room')
    set({ admitted: false, role: null, mode: 'enter', pendingCode: '', error: null })
  },
  setCrossword: (letters) => {
    set({ crossword: letters })
    if (suppress || !get().admitted) return
    queue({ crossword: letters })
  },
}))

async function runBoot() {
  try {
    const code = salaFromLocation()
    let memberships = loadMemberships()
    if (!memberships.length) {
      const legacy = localStorage.getItem(OWNER_KEY)
      if (legacy) {
        try {
          const found = await call({ action: 'recover', ownerToken: legacy })
          const member: Membership = {
            id: String(found.roomId),
            role: 'owner',
            token: legacy,
            name: String(found.name ?? 'Mi habitación'),
          }
          markLegacyRoom(member.id)
          memberships = upsertMembership(member)
          localStorage.removeItem(OWNER_KEY)
        } catch {
          localStorage.removeItem(OWNER_KEY)
        }
      }
    }
    localStorage.removeItem(GUEST_KEY)
    if (code) {
      const member = memberships.find((item) => item.id === code)
      if (member) {
        await openMembership(member, member.role === 'owner' && member.id === legacyRoomId())
        return
      }
      useLiveStore.setState({ ready: true, admitted: false, mode: 'enter', pendingCode: code, memberships, error: null })
      return
    }
    const current = localStorage.getItem(CURRENT_KEY)
    const member = memberships.find((item) => item.id === current) ?? memberships[0]
    if (member) {
      await openMembership(member, member.role === 'owner' && member.id === legacyRoomId())
      return
    }
    useLiveStore.setState({ ready: true, admitted: false, mode: 'create', pendingCode: '', memberships, error: null })
  } catch (error) {
    useLiveStore.setState({ ready: true, error: messageOf(error) })
  }
}

async function openMembership(member: Membership, seed: boolean) {
  stopSync()
  allowSeed = seed
  setRoomScope(member.id)
  rememberSala(member.id)
  localStorage.setItem(CURRENT_KEY, member.id)
  roomPaintId = null
  const tracks = seed ? await loadTracks() : []
  useRoomStore.setState({
    tracks,
    currentId: tracks[0]?.videoId ?? null,
    playing: false,
    startedAt: 0,
    position: 0,
    place: 'room',
  })
  useLiveStore.setState({
    ready: true,
    admitted: true,
    role: member.role,
    roomId: member.id,
    roomName: member.name,
    memberships: loadMemberships(),
    error: null,
    crossword: null,
    ownerOnline: false,
    guestOnline: false,
  })
  await startSync()
}

function loadMemberships(): Membership[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]') as Membership[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.token === 'string' && item.token)
  } catch {
    return []
  }
}

function upsertMembership(member: Membership) {
  const rows = [member, ...loadMemberships().filter((item) => item.id !== member.id)]
  localStorage.setItem(ROOMS_KEY, JSON.stringify(rows))
  useLiveStore.setState({ memberships: rows })
  return rows
}

function dropMembership(roomId: string) {
  const rows = loadMemberships().filter((item) => item.id !== roomId)
  localStorage.setItem(ROOMS_KEY, JSON.stringify(rows))
  useLiveStore.setState({ memberships: rows })
  return rows
}

function localOwnerToken(roomId: string) {
  return loadMemberships().find((item) => item.id === roomId && item.role === 'owner')?.token ?? ''
}

function salaFromLocation() {
  const value = new URLSearchParams(location.search).get('sala')?.trim().toLowerCase() ?? ''
  return /^[a-z0-9]{8}$/.test(value) ? value : ''
}

function rememberSala(roomId: string) {
  const url = new URL(location.href)
  url.searchParams.set('sala', roomId)
  history.replaceState(null, '', url)
}

function clearSala() {
  const url = new URL(location.href)
  url.searchParams.delete('sala')
  history.replaceState(null, '', url)
}

export function inviteUrl(roomId: string) {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('sala', roomId)
  return url.toString()
}

function authToken() {
  const { roomId } = useLiveStore.getState()
  return loadMemberships().find((item) => item.id === roomId)?.token ?? null
}

async function call(body: Record<string, unknown>, token = authToken()) {
  const roomless = body.action === 'create' || body.action === 'recover'
  const roomId = roomless ? undefined : (body.roomId ?? useLiveStore.getState().roomId)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token && body.action !== 'create') headers.authorization = `Bearer ${token}`
  const response = await fetch('/api/room', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, clientId, ...(roomId ? { roomId } : {}) }),
  })
  const data = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const current = useLiveStore.getState()
    if (response.status === 401 && current.admitted && current.roomId) {
      dropMembership(current.roomId)
      stopSync()
      useRoomStore.getState().go('room')
      useLiveStore.setState({
        admitted: false,
        role: null,
        mode: 'enter',
        pendingCode: current.roomId,
        error: 'La palabra cambió. Volvé a entrar.',
      })
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

function stopSync() {
  syncStarted = false
  allowSeed = false
  window.clearInterval(pollTimer)
  window.clearTimeout(pushTimer)
  pending = {}
  lastMask = ''
  roomPaintId = null
  stopPaint()
  stopImage()
  stopRoom()
  stopPaint = () => {}
  stopImage = () => {}
  stopRoom = () => {}
}

async function startSync() {
  if (syncStarted) return
  syncStarted = true
  window.clearInterval(pollTimer)
  stopPaint()
  stopImage()
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
  stopImage = onSharedImage((image) => void publishImage(image.kind, image.id, image.name, image.percent, image.blob))
  pollTimer = window.setInterval(() => void pull(false), 1000)
}

async function pull(initial: boolean) {
  const data = await call({ action: 'pull' })
  clockOffset = Number(data.serverNow) - Date.now()
  const body = data.body as {
    playback: Playback
    tracks: { videoId: string; title: string }[]
    frames: FrameSlot[]
    crossword: Record<string, string>
    paint: { shareId: string; name: string; percent: number; mask: string; ready: boolean } | null
  }
  const roomId = useLiveStore.getState().roomId
  if (typeof data.name === 'string' && roomId) {
    const rows = loadMemberships().map((item) => (item.id === roomId ? { ...item, name: data.name as string } : item))
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rows))
    useLiveStore.setState({ roomName: data.name, memberships: rows })
  }
  useLiveStore.setState({
    ownerOnline: Boolean(data.ownerOnline),
    guestOnline: Boolean(data.guestOnline),
    error: null,
  })
  const seed = initial && allowSeed
  const local = useRoomStore.getState()
  if (seed && body.tracks.length === 0 && local.tracks.length > 0) queue({ tracks: local.tracks, playback: playbackFromStore() })
  else applyPlayback(body.playback, body.tracks, String(data.updatedBy ?? ''))
  if (seed && Object.keys(body.crossword).length === 0) {
    const saved = localCrossword(roomId)
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
  const roomId = useLiveStore.getState().roomId ?? ''
  let changed = false
  for (const image of images) {
    const stamp = Number(image.updated_at)
    const key = `${roomId}:${image.id}`
    if (imageStamps.get(key) === stamp) continue
    const row = await call({ action: 'image-get', id: image.id })
    const blob = await (await fetch(String(row.image))).blob()
    await cacheSharedRecord(image.kind, image.id, String(row.name), Number(row.percent) || 0, blob)
    imageStamps.set(key, stamp)
    changed = true
  }
  if (changed) {
    useRoomStore.getState().bumpWorks()
    useRoomStore.getState().bumpFrames()
  }
}

async function applyPaint(paint: { shareId: string; name: string; percent: number; mask: string; ready: boolean } | null, seed: boolean) {
  roomPaintId = paint?.shareId ?? null
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
  if (roomPaintId && project.shareId !== roomPaintId) return
  if (!roomPaintId && !allowSeed && useLiveStore.getState().role !== 'owner') return
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
  const key = `${useLiveStore.getState().roomId}:${project.shareId}`
  if (uploaded.has(key)) return
  uploaded.add(key)
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

function localCrossword(roomId: string | null) {
  try {
    const scoped = roomId ? localStorage.getItem(`atelier-crucigrama:${roomId}`) : null
    const raw = scoped ?? (roomId && roomId === legacyRoomId() ? localStorage.getItem('atelier-crucigrama') : null)
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
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
