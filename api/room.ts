import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto'
import { promisify } from 'node:util'
import { neon } from '@neondatabase/serverless'

const scryptAsync = promisify(scrypt)

const EMPTY = {
  playback: { videoId: null as string | null, playing: false, startedAt: 0, position: 0 },
  tracks: [] as { videoId: string; title: string }[],
  frames: [null, null, null] as ({ kind: 'work' | 'photo'; id: string } | null)[],
  crossword: {} as Record<string, string>,
  paint: null as null | { shareId: string; name: string; percent: number; mask: string; ready: boolean },
}

type Body = typeof EMPTY
type Role = 'owner' | 'guest'

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

function guestToken(version: number) {
  const mac = createHmac('sha256', process.env.ROOM_SECRET!).update(`guest:${version}`).digest('hex')
  return `${version}.${mac}`
}

function guestOk(token: string, version: number) {
  const [raw, mac] = token.split('.')
  if (!mac || Number(raw) !== version) return false
  const expected = createHmac('sha256', process.env.ROOM_SECRET!).update(`guest:${version}`).digest('hex')
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

async function roomRow() {
  const sql = sqlClient()
  const rows = await sql`select keyword_salt, keyword_hash, owner_salt, owner_hash, version from room_lock where id = 1`
  return rows[0] as
    | { keyword_salt: string; keyword_hash: string; owner_salt: string; owner_hash: string; version: number }
    | undefined
}

async function authorize(request: Request): Promise<Role | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const room = await roomRow()
  if (!room) return null
  if (token.includes('.')) return guestOk(token, Number(room.version)) ? 'guest' : null
  return (await matches(token, room.owner_salt, room.owner_hash)) ? 'owner' : null
}

function asBody(value: unknown): Body {
  const source = value && typeof value === 'object' ? (value as Partial<Body>) : {}
  return {
    playback: source.playback ?? EMPTY.playback,
    tracks: Array.isArray(source.tracks) ? source.tracks : [],
    frames: Array.isArray(source.frames) && source.frames.length === 3 ? source.frames : EMPTY.frames,
    crossword: source.crossword && typeof source.crossword === 'object' ? source.crossword : {},
    paint: source.paint ?? null,
  }
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
    const action = payload.action
    const sql = sqlClient()
    if (action === 'status') {
      const room = await roomRow()
      return json(200, { exists: Boolean(room) })
    }
    if (action === 'create') {
      const keyword = word(payload.keyword)
      const ownerToken = typeof payload.ownerToken === 'string' ? payload.ownerToken.trim() : ''
      if (keyword.length < 2 || keyword.length > 40) return json(400, { error: 'La palabra necesita entre 2 y 40 letras.' })
      if (!/^[a-f0-9]{32,128}$/i.test(ownerToken)) return json(400, { error: 'No pude crear la habitación.' })
      if (await roomRow()) return json(409, { error: 'La habitación ya tiene dueño.' })
      const keywordSeal = await seal(keyword)
      const ownerSeal = await seal(ownerToken)
      await sql`
        insert into room_lock (id, keyword_salt, keyword_hash, owner_salt, owner_hash, version)
        values (1, ${keywordSeal.salt}, ${keywordSeal.hash}, ${ownerSeal.salt}, ${ownerSeal.hash}, 1)
      `
      await sql`
        insert into room_live (id, revision, body) values (1, 1, ${JSON.stringify(EMPTY)}::jsonb)
      `
      return json(200, { role: 'owner' })
    }
    if (action === 'enter') {
      const ip = clientIp(request)
      if (await locked(ip)) return json(429, { error: 'Demasiados intentos. Esperá un rato.' })
      const room = await roomRow()
      if (!room) return json(404, { error: 'Todavía no hay habitación.' })
      const ownerToken = typeof payload.ownerToken === 'string' ? payload.ownerToken.trim() : ''
      if (ownerToken && (await matches(ownerToken, room.owner_salt, room.owner_hash))) {
        await sql`delete from door_fails where ip = ${ip}`
        return json(200, { role: 'owner' })
      }
      const keyword = word(payload.keyword)
      if (!(await matches(keyword, room.keyword_salt, room.keyword_hash))) {
        await fail(ip)
        return json(401, { error: 'Esa no es la palabra.' })
      }
      await sql`delete from door_fails where ip = ${ip}`
      return json(200, { role: 'guest', token: guestToken(Number(room.version)) })
    }

    const role = await authorize(request)
    if (!role) return json(401, { error: 'La puerta se cerró. Volvé a entrar.' })
    if (role === 'owner') await sql`update room_live set owner_seen = now() where id = 1`
    else await sql`update room_live set guest_seen = now() where id = 1`

    if (action === 'keyword') {
      if (role !== 'owner') return json(403, { error: 'Solo el dueño puede cambiar la palabra.' })
      const keyword = word(payload.keyword)
      if (keyword.length < 2 || keyword.length > 40) return json(400, { error: 'La palabra necesita entre 2 y 40 letras.' })
      const room = await roomRow()
      if (!room) return json(404, { error: 'Todavía no hay habitación.' })
      const next = await seal(keyword)
      const version = Number(room.version) + 1
      await sql`
        update room_lock set keyword_salt = ${next.salt}, keyword_hash = ${next.hash}, version = ${version} where id = 1
      `
      return json(200, { ok: true, version })
    }

    if (action === 'pull') {
      const rows = await sql`
        select revision, body, updated_by,
          owner_seen > now() - interval '8 seconds' as owner_online,
          guest_seen > now() - interval '8 seconds' as guest_online,
          (extract(epoch from now()) * 1000)::bigint as server_now
        from room_live where id = 1
      `
      const images = await sql`select id, kind, name, percent, updated_at from room_images order by updated_at desc`
      const row = rows[0] as {
        revision: string
        body: Body
        updated_by: string | null
        owner_online: boolean
        guest_online: boolean
        server_now: string
      }
      return json(200, {
        revision: Number(row.revision),
        body: asBody(row.body),
        updatedBy: row.updated_by,
        ownerOnline: Boolean(row.owner_online),
        guestOnline: Boolean(row.guest_online),
        serverNow: Number(row.server_now),
        images,
      })
    }

    if (action === 'push') {
      const clientId = typeof payload.clientId === 'string' ? payload.clientId.slice(0, 80) : ''
      const rows = await sql`select revision, body from room_live where id = 1`
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
      if (Array.isArray(patch.frames) && patch.frames.length === 3) body.frames = patch.frames as Body['frames']
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
        where id = 1
        returning revision
      `
      return json(200, { revision: Number((saved[0] as { revision: string }).revision) })
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
        insert into room_images (id, kind, name, percent, updated_at, image)
        values (${id}, ${kind}, ${name}, ${percent}, ${updatedAt}, ${image})
        on conflict (id) do update set name = ${name}, percent = ${percent}, updated_at = ${updatedAt}, image = ${image}, kind = ${kind}
      `
      return json(200, { ok: true, updatedAt })
    }

    if (action === 'image-get') {
      const id = typeof payload.id === 'string' ? payload.id : ''
      const rows = await sql`select kind, name, percent, updated_at, image from room_images where id = ${id}`
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
        insert into room_geometry (share_id, seq, total, data)
        values (${`${shareId}:${part}`}, ${seq}, ${total}, ${data})
        on conflict (share_id, seq) do update set total = ${total}, data = ${data}
      `
      return json(200, { ok: true })
    }

    if (action === 'geometry-ready') {
      const shareId = typeof payload.shareId === 'string' ? payload.shareId.slice(0, 80) : ''
      const rows = await sql`select body from room_live where id = 1`
      const body = asBody((rows[0] as { body: Body }).body)
      if (body.paint?.shareId === shareId) {
        body.paint.ready = true
        await sql`update room_live set body = ${JSON.stringify(body)}::jsonb, revision = revision + 1 where id = 1`
      }
      return json(200, { ok: true })
    }

    if (action === 'geometry-get') {
      const shareId = typeof payload.shareId === 'string' ? payload.shareId.slice(0, 80) : ''
      const part = typeof payload.part === 'string' ? payload.part.slice(0, 40) : ''
      const rows = await sql`select seq, total, data from room_geometry where share_id = ${`${shareId}:${part}`} order by seq`
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
