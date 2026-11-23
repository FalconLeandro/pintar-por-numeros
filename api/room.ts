import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { neon } from '@neondatabase/serverless'

const scryptAsync = promisify(scrypt)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE = /^[a-z0-9]{8}$/

const EMPTY = {
  playback: { videoId: null as string | null, playing: false, startedAt: 0, position: 0 },
  tracks: [] as { videoId: string; title: string }[],
  frames: [null, null, null] as ({ kind: 'work' | 'photo'; id: string } | null)[],
  crossword: {} as Record<string, string>,
  paint: null as null | { shareId: string; name: string; percent: number; mask: string; ready: boolean },
  look: {
    layout: 'clasica',
    size: 'mediano',
    background: false,
    palette: 'papel',
    frameCount: 3,
    welcome: 'Un lugar para quedarse un rato.',
    objects: { easel: true, drawer: true, player: true, crossword: true },
    frameStyle: 'tinta',
    cat: 'negra',
    dedication: '',
  },
}

type Body = typeof EMPTY
type Role = 'owner' | 'guest'
type RoomLock = {
  id: number
  public_id: string
  name: string
  keyword_salt: string
  keyword_hash: string
  owner_salt: string
  owner_hash: string
  version: number
}

function sqlClient() {
  const url = process.env.DATABASE_URL
  if (!url || !process.env.ROOM_SECRET) throw new Error('Falta la configuración de la habitación')
  return neon(url)
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function roomCode() {
  const bytes = randomBytes(8)
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

function codeOf(value: unknown) {
  if (typeof value !== 'string') return ''
  const code = value.trim().toLowerCase()
  return CODE.test(code) ? code : ''
}

function roomName(value: unknown) {
  if (typeof value !== 'string') return 'Mi habitación'
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 40)
  return name || 'Mi habitación'
}

async function digest(secret: string, salt: string) {
  const derived = (await scryptAsync(`${secret}:${process.env.ROOM_SECRET}`, salt, 32)) as Buffer
  return derived.toString('hex')
}

async function seal(secret: string) {
  const salt = randomBytes(16).toString('hex')
  return { salt, hash: await digest(secret, salt) }
}

async function matches(secret: string, salt: string, expected: string) {
  const actual = await digest(secret, salt)
  const left = Buffer.from(actual, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function guestToken(publicId: string, version: number) {
  const mac = createHmac('sha256', process.env.ROOM_SECRET!).update(`guest:${publicId}:${version}`).digest('hex')
  return `${version}.${mac}`
}

function guestOk(token: string, publicId: string, version: number) {
  const [raw, mac] = token.split('.')
  if (!mac || Number(raw) !== version) return false
  const expected = createHmac('sha256', process.env.ROOM_SECRET!).update(`guest:${publicId}:${version}`).digest('hex')
  const left = Buffer.from(mac, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || 'local'
}

function word(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ')
}

async function locked(ip: string) {
  const sql = sqlClient()
  const rows = await sql`select fails, until_at from door_fails where ip = ${ip}`
  const row = rows[0] as { fails: number; until_at: string | null } | undefined
  if (row?.until_at && new Date(row.until_at).getTime() > Date.now()) return true
  return false
}

async function fail(ip: string) {
  const sql = sqlClient()
  const rows = await sql`select fails from door_fails where ip = ${ip}`
  const fails = Number((rows[0] as { fails?: number } | undefined)?.fails ?? 0) + 1
  const until = fails >= 8 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
  await sql`
    insert into door_fails (ip, fails, until_at) values (${ip}, ${fails}, ${until})
    on conflict (ip) do update set fails = ${fails}, until_at = ${until}
  `
}

let schemaPromise: Promise<void> | null = null

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = migrate().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function migrate() {
  const sql = sqlClient()
  await sql`alter table room_lock add column if not exists public_id text`
  await sql`alter table room_lock add column if not exists name text not null default 'Mi habitación'`
  await sql`alter table room_images add column if not exists room_id integer not null default 1`
  await sql`alter table room_geometry add column if not exists room_id integer not null default 1`
  await sql`alter table room_live add column if not exists chat jsonb not null default '[]'::jsonb`
  const missing = await sql`select id from room_lock where public_id is null`
  for (const row of missing) {
    const id = Number((row as { id: number }).id)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const updated = await sql`
          update room_lock set public_id = ${roomCode()} where id = ${id} and public_id is null returning public_id
        `
        if (updated.length || attempt === 5) break
      } catch {
        if (attempt === 5) throw new Error('No pude preparar la habitación')
      }
    }
  }
  await sql`create unique index if not exists room_lock_public_id_key on room_lock (public_id)`
}

async function roomByCode(publicId: string) {
  const sql = sqlClient()
  const rows = await sql`
    select id, public_id, name, keyword_salt, keyword_hash, owner_salt, owner_hash, version
    from room_lock where public_id = ${publicId}
  `
  return rows[0] as RoomLock | undefined
}

async function authorize(request: Request, room: RoomLock): Promise<Role | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  if (token.includes('.')) return guestOk(token, room.public_id, Number(room.version)) ? 'guest' : null
  return (await matches(token, room.owner_salt, room.owner_hash)) ? 'owner' : null
}

function asLook(value: unknown) {
  const source = value && typeof value === 'object' ? (value as Partial<Body['look']>) : {}
  const objects = source.objects && typeof source.objects === 'object' ? source.objects : EMPTY.look.objects
  const count = Number(source.frameCount)
  const welcome = typeof source.welcome === 'string' ? source.welcome.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  const dedication = typeof source.dedication === 'string' ? source.dedication.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) =>
    allowed.includes(value as T) ? (value as T) : fallback
  return {
    layout: oneOf(source.layout, ['clasica', 'ancha', 'torre'] as const, EMPTY.look.layout),
    size: oneOf(source.size, ['chico', 'mediano', 'grande'] as const, EMPTY.look.size),
    background: Boolean(source.background),
    palette: oneOf(source.palette, ['papel', 'noche', 'rosa', 'salvia', 'mar'] as const, EMPTY.look.palette),
    frameCount: Number.isInteger(count) && count >= 1 && count <= 6 ? count : EMPTY.look.frameCount,
    welcome: welcome || EMPTY.look.welcome,
    objects: {
      easel: objects.easel !== false,
      drawer: objects.drawer !== false,
      player: objects.player !== false,
      crossword: objects.crossword !== false,
    },
    frameStyle: oneOf(source.frameStyle, ['tinta', 'linea', 'madera', 'oro'] as const, EMPTY.look.frameStyle),
    cat: oneOf(source.cat, ['negra', 'blanca', 'ninguna'] as const, EMPTY.look.cat),
    dedication,
  }
}

function asBody(value: unknown): Body {
  const source = value && typeof value === 'object' ? (value as Partial<Body>) : {}
  return {
    playback: source.playback ?? EMPTY.playback,
    tracks: Array.isArray(source.tracks) ? source.tracks : [],
    frames: Array.isArray(source.frames) && source.frames.length >= 1 && source.frames.length <= 6 ? source.frames : EMPTY.frames,
    crossword: source.crossword && typeof source.crossword === 'object' ? source.crossword : {},
    paint: source.paint ?? null,
    look: asLook(source.look),
  }
}

type ChatMessage = { id: string; role: Role; text: string; at: number }

function asChat(value: unknown): ChatMessage[] {
  let source = value
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(source)) return []
  return source
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Partial<ChatMessage>) : {}
      const text = typeof row.text === 'string' ? row.text.trim().replace(/\s+/g, ' ').slice(0, 240) : ''
      const id = typeof row.id === 'string' ? row.id.slice(0, 40) : ''
      if (!text || !id) return null
      return { id, role: row.role === 'owner' ? 'owner' : 'guest', text, at: Number(row.at) || 0 } satisfies ChatMessage
    })
    .filter((item): item is ChatMessage => item !== null)
    .slice(-40)
}

async function notePresence(roomId: number, role: Role) {
  const sql = sqlClient()
  const rows = await sql`
    select
      coalesce(owner_seen > now() - interval '8 seconds', false) as owner_online,
      coalesce(guest_seen > now() - interval '8 seconds', false) as guest_online
    from room_live where id = ${roomId}
  `
  const row = rows[0] as { owner_online: boolean; guest_online: boolean } | undefined
  if (row && !row.owner_online && !row.guest_online) {
    await sql`update room_live set chat = '[]'::jsonb where id = ${roomId}`
  }
  if (role === 'owner') await sql`update room_live set owner_seen = now() where id = ${roomId}`
  else await sql`update room_live set guest_seen = now() where id = ${roomId}`
}

async function insertRoom(name: string, keywordSeal: { salt: string; hash: string }, ownerSeal: { salt: string; hash: string }) {
  const sql = sqlClient()
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = roomCode()
    const next = await sql`select coalesce(max(id), 0) + 1 as id from room_lock`
    const id = Number((next[0] as { id: number }).id)
    try {
      await sql`
        insert into room_lock (id, public_id, name, keyword_salt, keyword_hash, owner_salt, owner_hash, version)
        values (${id}, ${code}, ${name}, ${keywordSeal.salt}, ${keywordSeal.hash}, ${ownerSeal.salt}, ${ownerSeal.hash}, 1)
      `
      try {
        await sql`insert into room_live (id, revision, body) values (${id}, 1, ${JSON.stringify(EMPTY)}::jsonb)`
      } catch (error) {
        await sql`delete from room_lock where id = ${id} and not exists (select 1 from room_live where room_live.id = ${id})`
        throw error
      }
      return { id, publicId: code, name }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No pude crear la habitación')
}

export async function handleRoom(request: Request) {
  if (request.method !== 'POST') return json(405, { error: 'Método no permitido' })
  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return json(400, { error: 'No entendí el pedido' })
  }
  try {
    await ensureSchema()
    const action = payload.action
    const sql = sqlClient()
    const ip = clientIp(request)

    if (action === 'create') {
      const keyword = word(payload.keyword)
      const ownerToken = typeof payload.ownerToken === 'string' ? payload.ownerToken.trim() : ''
      const name = roomName(payload.name)
      if (keyword.length < 2 || keyword.length > 40) return json(400, { error: 'La palabra necesita entre 2 y 40 letras.' })
      if (!/^[a-f0-9]{32,128}$/i.test(ownerToken)) return json(400, { error: 'No pude crear la habitación.' })
      const created = await insertRoom(name, await seal(keyword), await seal(ownerToken))
      return json(200, { role: 'owner', roomId: created.publicId, name: created.name })
    }

    if (action === 'recover') {
      if (await locked(ip)) return json(429, { error: 'Demasiados intentos. Esperá un rato.' })
      const ownerToken = typeof payload.ownerToken === 'string' ? payload.ownerToken.trim() : ''
      if (!/^[a-f0-9]{32,128}$/i.test(ownerToken)) return json(404, { error: 'No encontré tu habitación.' })
      const rooms = await sql`select id, public_id, name, owner_salt, owner_hash from room_lock where public_id is not null`
      for (const row of rooms) {
        const room = row as Pick<RoomLock, 'public_id' | 'name' | 'owner_salt' | 'owner_hash'>
        if (await matches(ownerToken, room.owner_salt, room.owner_hash)) {
          await sql`delete from door_fails where ip = ${ip}`
          return json(200, { role: 'owner', roomId: room.public_id, name: room.name })
        }
      }
      await fail(ip)
      return json(404, { error: 'No encontré tu habitación.' })
    }

    if (action === 'enter') {
      if (await locked(ip)) return json(429, { error: 'Demasiados intentos. Esperá un rato.' })
      const room = await roomByCode(codeOf(payload.roomId))
      if (!room) return json(404, { error: 'No encontré esa habitación.' })
      const ownerToken = typeof payload.ownerToken === 'string' ? payload.ownerToken.trim() : ''
      if (ownerToken && (await matches(ownerToken, room.owner_salt, room.owner_hash))) {
        await sql`delete from door_fails where ip = ${ip}`
        return json(200, { role: 'owner', roomId: room.public_id, name: room.name })
      }
      const keyword = word(payload.keyword)
      if (!(await matches(keyword, room.keyword_salt, room.keyword_hash))) {
        await fail(ip)
        return json(401, { error: 'Esa no es la palabra.' })
      }
      await sql`delete from door_fails where ip = ${ip}`
      return json(200, { role: 'guest', roomId: room.public_id, name: room.name, token: guestToken(room.public_id, Number(room.version)) })
    }

    const room = await roomByCode(codeOf(payload.roomId))
    if (!room) return json(404, { error: 'No encontré esa habitación.' })
    const role = await authorize(request, room)
    if (!role) return json(401, { error: 'La puerta se cerró. Volvé a entrar.' })
    await notePresence(room.id, role)

    if (action === 'keyword') {
      if (role !== 'owner') return json(403, { error: 'Solo el dueño puede cambiar la palabra.' })
      const keyword = word(payload.keyword)
      if (keyword.length < 2 || keyword.length > 40) return json(400, { error: 'La palabra necesita entre 2 y 40 letras.' })
      const next = await seal(keyword)
      const version = Number(room.version) + 1
      await sql`
        update room_lock set keyword_salt = ${next.salt}, keyword_hash = ${next.hash}, version = ${version} where id = ${room.id}
      `
      return json(200, { ok: true, version })
    }

    if (action === 'rename') {
      if (role !== 'owner') return json(403, { error: 'Solo el dueño puede cambiar el nombre.' })
      const name = roomName(payload.name)
      if (payload.name !== undefined && String(payload.name).trim().length < 2) {
        return json(400, { error: 'El nombre necesita entre 2 y 40 letras.' })
      }
      await sql`update room_lock set name = ${name} where id = ${room.id}`
      return json(200, { name })
    }

    if (action === 'pull') {
      const rows = await sql`
        select revision, body, chat, updated_by,
          owner_seen > now() - interval '8 seconds' as owner_online,
          guest_seen > now() - interval '8 seconds' as guest_online,
          (extract(epoch from now()) * 1000)::bigint as server_now
        from room_live where id = ${room.id}
      `
      const images = await sql`
        select id, kind, name, percent, updated_at from room_images
        where room_id = ${room.id} order by updated_at desc
      `
      const row = rows[0] as {
        revision: string
        body: Body
        chat: unknown
        updated_by: string | null
        owner_online: boolean
        guest_online: boolean
        server_now: string
      }
      return json(200, {
        revision: Number(row.revision),
        body: asBody(row.body),
        chat: asChat(row.chat),
        updatedBy: row.updated_by,
        ownerOnline: Boolean(row.owner_online),
        guestOnline: Boolean(row.guest_online),
        serverNow: Number(row.server_now),
        name: room.name,
        roomId: room.public_id,
        images,
      })
    }

    if (action === 'push') {
      const clientId = typeof payload.clientId === 'string' ? payload.clientId.slice(0, 80) : ''
      const rows = await sql`select revision, body from room_live where id = ${room.id}`
      const current = rows[0] as { revision: string; body: Body }
      const body = asBody(current.body)
      const patch = (payload.patch ?? {}) as Record<string, unknown>
      if (patch.playback && typeof patch.playback === 'object') {
        const next = patch.playback as Body['playback']
        const prev = body.playback
        let startedAt = prev.startedAt
        if (next.playing && (!prev.playing || prev.videoId !== next.videoId)) {
          startedAt = Date.now() - Math.max(0, Number(next.position) || 0) * 1000
        }
        body.playback = {
          videoId: typeof next.videoId === 'string' ? next.videoId : null,
          playing: Boolean(next.playing),
          startedAt,
          position: Math.max(0, Number(next.position) || 0),
        }
      }
      if (Array.isArray(patch.tracks)) {
        body.tracks = patch.tracks
          .filter((track) => track && typeof track.videoId === 'string' && typeof track.title === 'string')
          .slice(0, 40)
          .map((track) => ({ videoId: String(track.videoId).slice(0, 20), title: String(track.title).slice(0, 140) }))
      }
      if (Array.isArray(patch.frames) && patch.frames.length >= 1 && patch.frames.length <= 6) body.frames = patch.frames as Body['frames']
      if (patch.look && role === 'owner') body.look = asLook(patch.look)
      if (patch.crossword && typeof patch.crossword === 'object') {
        const incoming = patch.crossword as Record<string, unknown>
        for (const [key, value] of Object.entries(incoming).slice(0, 80)) {
          if (!/^\d+,\d+$/.test(key) || typeof value !== 'string') continue
          body.crossword[key] = value.slice(0, 1).toUpperCase()
        }
      }
      if (patch.paint && typeof patch.paint === 'object') {
        const paint = patch.paint as { shareId?: string; name?: string; percent?: number; mask?: string; ids?: number[] }
        if (paint.mask && paint.shareId) {
          body.paint = {
            shareId: paint.shareId.slice(0, 80),
            name: String(paint.name ?? 'Pintura').slice(0, 80),
            percent: Math.max(0, Math.min(100, Number(paint.percent) || 0)),
            mask: paint.mask.slice(0, 200_000),
            ready: body.paint?.shareId === paint.shareId ? body.paint.ready : false,
          }
        } else if (paint.ids && body.paint && paint.shareId === body.paint.shareId) {
          const bytes = Buffer.from(body.paint.mask, 'base64')
          for (const id of paint.ids.slice(0, 8000)) {
            if (Number.isInteger(id) && id > 0 && id < bytes.length) bytes[id] = 1
          }
          body.paint.mask = bytes.toString('base64')
          body.paint.percent = Math.max(0, Math.min(100, Number(paint.percent) || body.paint.percent))
          if (paint.name) body.paint.name = String(paint.name).slice(0, 80)
        }
      }
      const saved = await sql`
        update room_live
        set body = ${JSON.stringify(body)}::jsonb, revision = revision + 1, updated_by = ${clientId}
        where id = ${room.id}
        returning revision
      `
      return json(200, { revision: Number((saved[0] as { revision: string }).revision) })
    }

    if (action === 'say') {
      const text = typeof payload.text === 'string' ? payload.text.trim().replace(/\s+/g, ' ').slice(0, 240) : ''
      if (!text) return json(400, { error: 'Escribí algo.' })
      const message = { id: randomBytes(6).toString('hex'), role, text, at: Date.now() }
      const saved = await sql`
        update room_live
        set chat = (
          select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
          from (
            select item, ord
            from jsonb_array_elements(case when jsonb_typeof(chat) = 'array' then chat else '[]'::jsonb end)
              with ordinality as t(item, ord)
            order by ord desc
            limit 39
          ) kept
        ) || ${JSON.stringify([message])}::jsonb
        where id = ${room.id}
        returning chat
      `
      return json(200, { chat: asChat((saved[0] as { chat: unknown } | undefined)?.chat) })
    }

    if (action === 'image-put') {
      const id = typeof payload.id === 'string' ? payload.id.slice(0, 80) : ''
      const kind = payload.kind === 'photo' ? 'photo' : 'work'
      const name = typeof payload.name === 'string' ? payload.name.slice(0, 80) : 'Obra'
      const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0))
      const image = typeof payload.image === 'string' ? payload.image : ''
      if (!id || image.length < 32 || image.length > 2_000_000) return json(400, { error: 'No pude guardar la imagen.' })
      const updatedAt = Date.now()
      await sql`
        insert into room_images (id, kind, name, percent, updated_at, image, room_id)
        values (${id}, ${kind}, ${name}, ${percent}, ${updatedAt}, ${image}, ${room.id})
        on conflict (id) do update set name = ${name}, percent = ${percent}, updated_at = ${updatedAt}, image = ${image}, kind = ${kind}, room_id = ${room.id}
      `
      return json(200, { ok: true, updatedAt })
    }

    if (action === 'image-get') {
      const id = typeof payload.id === 'string' ? payload.id : ''
      const rows = await sql`
        select kind, name, percent, updated_at, image from room_images where id = ${id} and room_id = ${room.id}
      `
      const row = rows[0] as { kind: string; name: string; percent: number; updated_at: string; image: string } | undefined
      if (!row) return json(404, { error: 'No está esa imagen.' })
      return json(200, row)
    }

    if (action === 'geometry') {
      const shareId = typeof payload.shareId === 'string' ? payload.shareId.slice(0, 80) : ''
      const part = typeof payload.part === 'string' ? payload.part.slice(0, 40) : ''
      const seq = Number(payload.seq)
      const total = Number(payload.total)
      const data = typeof payload.data === 'string' ? payload.data : ''
      if (!shareId || !part || !Number.isInteger(seq) || !Number.isInteger(total) || total < 1 || total > 40 || data.length > 400_000) {
        return json(400, { error: 'No pude guardar la pintura.' })
      }
      await sql`
        insert into room_geometry (share_id, seq, total, data, room_id)
        values (${`${shareId}:${part}`}, ${seq}, ${total}, ${data}, ${room.id})
        on conflict (share_id, seq) do update set total = ${total}, data = ${data}, room_id = ${room.id}
      `
      return json(200, { ok: true })
    }

    if (action === 'geometry-ready') {
      const shareId = typeof payload.shareId === 'string' ? payload.shareId.slice(0, 80) : ''
      const rows = await sql`select body from room_live where id = ${room.id}`
      const body = asBody((rows[0] as { body: Body }).body)
      if (body.paint?.shareId === shareId) {
        body.paint.ready = true
        await sql`update room_live set body = ${JSON.stringify(body)}::jsonb, revision = revision + 1 where id = ${room.id}`
      }
      return json(200, { ok: true })
    }

    if (action === 'geometry-get') {
      const shareId = typeof payload.shareId === 'string' ? payload.shareId.slice(0, 80) : ''
      const part = typeof payload.part === 'string' ? payload.part.slice(0, 40) : ''
      const rows = await sql`
        select seq, total, data from room_geometry
        where share_id = ${`${shareId}:${part}`} and room_id = ${room.id}
        order by seq
      `
      return json(200, { chunks: rows })
    }

    return json(400, { error: 'No entendí el pedido' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No pude hablar con la habitación'
    return json(500, { error: message })
  }
}

type NodeRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type NodeResponse = {
  status: (code: number) => NodeResponse
  setHeader: (name: string, value: string) => void
  send: (body: string) => void
}

function encodeBody(body: unknown) {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return JSON.stringify(body ?? {})
}

export default async function handler(req: NodeRequest, res: NodeResponse) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(','))
  }
  const request = new Request('https://atelier.local/api/room', {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : encodeBody(req.body),
  })
  const response = await handleRoom(request)
  res.status(response.status)
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.send(await response.text())
}
