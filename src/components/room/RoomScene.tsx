import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Disc3, Frame, Paintbrush } from 'lucide-react'
import { BlackCat } from '../TopBar.tsx'
import { RoomHeader } from './RoomHeader.tsx'
import { RoomLookSheet } from './RoomLookSheet.tsx'
import { usePaintStore } from '../../store/usePaintStore.ts'
import { publishFrames } from '../../room/live.ts'
import { useLiveStore } from '../../room/live.ts'
import { emitSharedImage } from '../../room/events.ts'
import { backgroundId, type FrameStyle, type RoomSize } from '../../room/look.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'
import {
  getPhoto,
  getWork,
  listPhotos,
  listWorks,
  loadFrames,
  saveFrames,
  savePhoto,
  workIsComplete,
  workPercent,
  type FrameSlot,
  type PhotoRecord,
  type WorkRecord,
} from '../../utils/roomDb.ts'

const FRAME_BORDER: Record<FrameStyle, string> = {
  tinta: 'border-[10px] border-ink',
  linea: 'border-2 border-line',
  madera: 'border-[10px] border-[#8a5a32]',
  oro: 'border-[10px] border-[#c6a15b]',
}

interface FrameView {
  slot: Exclude<FrameSlot, null>
  url: string
  title: string
}

export function RoomScene() {
  const go = useRoomStore((state) => state.go)
  const setPlayerOpen = useRoomStore((state) => state.setPlayerOpen)
  const framesVersion = useRoomStore((state) => state.framesVersion)
  const worksVersion = useRoomStore((state) => state.worksVersion)
  const bumpFrames = useRoomStore((state) => state.bumpFrames)
  const project = usePaintStore((state) => state.project)
  const role = useLiveStore((state) => state.role)
  const roomName = useLiveStore((state) => state.roomName)
  const roomId = useLiveStore((state) => state.roomId)
  const look = useLiveStore((state) => state.look)
  const ownerOnline = useLiveStore((state) => state.ownerOnline)
  const guestOnline = useLiveStore((state) => state.guestOnline)
  const [frames, setFrames] = useState<Array<FrameView | null>>([null, null, null])
  const [editing, setEditing] = useState<number | null>(null)
  const [viewing, setViewing] = useState<FrameView | null>(null)
  const [customizing, setCustomizing] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)

  useEffect(() => {
    if (editing === null && !viewing && !customizing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      if (viewing) setViewing(null)
      else if (customizing) setCustomizing(false)
      else setEditing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing, viewing, customizing])

  useEffect(() => {
    let cancel = false
    const urls: string[] = []
    void loadFrames().then(async (slots) => {
      const views = await Promise.all(
        slots.map(async (slot) => {
          if (!slot) return null
          const record = slot.kind === 'work' ? await getWork(slot.id) : await getPhoto(slot.id)
          if (!record) return null
          const url = URL.createObjectURL(record.blob)
          urls.push(url)
          return { slot, url, title: record.name }
        }),
      )
      if (cancel) {
        urls.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      setFrames(views)
    })
    return () => {
      cancel = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [framesVersion, worksVersion])

  useEffect(() => {
    if (!look.background || !roomId) {
      setBackgroundUrl(null)
      return
    }
    let url = ''
    let cancel = false
    void getPhoto(backgroundId(roomId)).then((photo) => {
      if (!photo || cancel) return
      url = URL.createObjectURL(photo.blob)
      setBackgroundUrl(url)
    })
    return () => {
      cancel = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [look.background, roomId, worksVersion])

  const shown = Array.from({ length: look.frameCount }, (_, index) => frames[index] ?? null)
  const frameWidth = look.size === 'chico' ? 'max-w-36' : look.size === 'grande' ? 'max-w-72' : 'max-w-56'
  const wallGrid =
    look.layout === 'torre' || look.frameCount === 1
      ? 'grid-cols-1'
      : look.frameCount === 2
        ? 'grid-cols-2'
        : 'grid-cols-2 sm:grid-cols-3'
  const activities = [
    look.objects.easel ? (
      <FloorButton
        key="easel"
        size={look.size}
        icon={<Paintbrush size={18} />}
        label="Caballete"
        detail={project ? `Seguir ${project.name}` : 'Pintar por números'}
        onClick={() => {
          setPlayerOpen(false)
          usePaintStore.getState().dismissRestored()
          go('paint')
        }}
      />
    ) : null,
    look.objects.drawer ? (
      <FloorButton key="drawer" size={look.size} icon={<Frame size={18} />} label="Cajón" detail="Obras terminadas" onClick={() => { setPlayerOpen(false); go('drawer') }} />
    ) : null,
    look.objects.player ? (
      <FloorButton key="player" size={look.size} icon={<Disc3 size={18} />} label="Tocadiscos" detail="Música de fondo" onClick={() => setPlayerOpen(true)} />
    ) : null,
    look.objects.crossword ? (
      <FloorButton key="crossword" size={look.size} icon={<BookOpen size={18} />} label="Crucigrama" detail="Sobre la mesa" onClick={() => { setPlayerOpen(false); go('crossword') }} />
    ) : null,
  ].filter(Boolean)
  const floorGrid =
    look.layout === 'torre' || activities.length <= 1
      ? 'grid-cols-1'
      : activities.length === 2
        ? 'grid-cols-2'
        : activities.length === 3
          ? 'grid-cols-2 sm:grid-cols-3'
          : 'grid-cols-2 sm:grid-cols-4'
  const shell = look.layout === 'ancha' ? 'mt-6 flex flex-col gap-4 lg:flex-row lg:items-start' : 'mt-6'
  const wallClass = look.layout === 'ancha' ? 'min-w-0 flex-1 rounded-[2rem]' : 'rounded-t-[2rem] border-b-0'
  const floorClass = look.layout === 'ancha' ? 'w-full rounded-[2rem] lg:w-80' : 'rounded-b-[2rem]'

  return (
    <div className="relative flex h-dvh flex-col bg-paper">
      <RoomHeader />
      <div
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-auto px-4 py-5 pb-36"
        style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className={backgroundUrl ? 'rounded-[2rem] bg-paper/85 p-4' : undefined}>
        <p className="text-xs font-medium tracking-[0.22em] text-studio uppercase">{roomName || 'Habitación'}</p>
        <h1 className="mt-2 max-w-xl font-display text-4xl leading-tight">{look.welcome}</h1>
        {look.dedication && <p className="mt-3 max-w-xl font-display text-xl leading-snug">{look.dedication}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-soft">
            {role === 'owner' ? 'Sos el dueño de la palabra.' : 'Entraste como invitado.'}
            {role === 'owner' && guestOnline ? ' Hay un invitado ahora.' : ''}
            {role === 'guest' && ownerOnline ? ' El dueño está ahora.' : ''}
          </p>
          {role === 'owner' && (
            <button type="button" className="rounded-full border border-line bg-foam px-3 py-1 text-sm" onClick={() => setCustomizing(true)}>
              Personalizar
            </button>
          )}
        </div>
        <div className={shell}>
        <section className={`relative border border-line px-4 pt-6 pb-8 ${wallClass} ${backgroundUrl ? 'bg-paper-deep/90' : 'bg-paper-deep'}`}>
          <div className={`grid gap-4 ${wallGrid}`}>
            {shown.map((frame, index) => (
              <button
                key={index}
                type="button"
                onClick={() => (frame ? setViewing(frame) : setEditing(index))}
                className={`group mx-auto flex w-full flex-col items-center ${frameWidth}`}
              >
                <span className={`block w-full rounded-md bg-foam p-2 shadow-lg ${FRAME_BORDER[look.frameStyle]}`}>
                  {frame ? (
                    <img src={frame.url} alt="" className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <span className="grid aspect-[3/4] place-items-center text-ink-soft">
                      <Frame size={28} />
                    </span>
                  )}
                </span>
                <span className="mt-2 text-xs text-ink-soft">{frame ? frame.title : `Cuadro ${index + 1}`}</span>
              </button>
            ))}
          </div>
        </section>
        <section className={`border border-line bg-ink/10 px-4 py-5 ${floorClass}`}>
          {activities.length > 0 && <div className={`grid gap-3 ${floorGrid}`}>{activities}</div>}
          {(look.cat !== 'ninguna' || activities.length > 0) && (
            <div className={`flex items-end justify-between ${activities.length > 0 ? 'mt-4' : ''}`}>
              {look.cat !== 'ninguna' ? (
                <span className={look.size === 'chico' ? 'origin-bottom-left scale-75' : look.size === 'grande' ? 'origin-bottom-left scale-125' : ''}>
                  <BlackCat tone={look.cat === 'blanca' ? 'blanca' : 'negra'} />
                </span>
              ) : (
                <span />
              )}
              <p className="max-w-xs text-right text-xs text-ink-soft">
                {look.cat === 'ninguna' ? 'La música se queda, si la dejás sonando.' : 'La gata se queda. La música también, si la dejás sonando.'}
              </p>
            </div>
          )}
        </section>
        </div>
        </div>
      </div>
      {editing !== null && (
        <FrameSheet
          index={editing}
          onClose={() => setEditing(null)}
          onPick={async (slot) => {
            const count = useLiveStore.getState().look.frameCount
            const slots = await loadFrames()
            const next = Array.from({ length: Math.max(count, slots.length) }, (_, index) => slots[index] ?? null)
            next[editing] = slot
            await saveFrames(next)
            void publishFrames()
            bumpFrames()
            setEditing(null)
          }}
        />
      )}
      {viewing && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-ink/50 p-4" onMouseDown={() => setViewing(null)}>
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-foam shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <img src={viewing.url} alt="" className="max-h-[60vh] w-full object-contain bg-paper" />
            <div className="flex items-center justify-between gap-3 p-4">
              <p className="font-display text-xl">{viewing.title}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-full px-3 py-1.5 text-sm text-ink-soft"
                  onClick={() => {
                    const index = frames.findIndex((frame) => frame?.slot.id === viewing.slot.id && frame.slot.kind === viewing.slot.kind)
                    setViewing(null)
                    if (index >= 0) setEditing(index)
                  }}
                >
                  Cambiar
                </button>
                <button
                  type="button"
                  className="studio-action"
                  onClick={() => {
                    void loadFrames().then(async (next) => {
                      const index = next.findIndex((slot) => slot?.id === viewing.slot.id && slot.kind === viewing.slot.kind)
                      if (index >= 0) next[index] = null
                      await saveFrames(next)
                      void publishFrames()
                      bumpFrames()
                      setViewing(null)
                    })
                  }}
                >
                  Quitar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {customizing && <RoomLookSheet onClose={() => setCustomizing(false)} />}
    </div>
  )
}

function FloorButton({ icon, label, detail, onClick, size }: { icon: ReactNode; label: string; detail: string; onClick: () => void; size: RoomSize }) {
  const pad = size === 'chico' ? 'px-3 py-3' : size === 'grande' ? 'px-5 py-6' : 'px-4 py-4'
  const title = size === 'chico' ? 'text-lg' : size === 'grande' ? 'text-2xl' : 'text-xl'
  return (
    <button type="button" onClick={onClick} className={`rounded-3xl border border-line bg-foam text-left shadow-sm hover:-translate-y-0.5 hover:shadow-md ${pad}`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-paper text-ink">{icon}</span>
      <span className={`mt-3 block font-display leading-none ${title}`}>{label}</span>
      <span className="mt-1 block truncate text-xs text-ink-soft">{detail}</span>
    </button>
  )
}

function FrameSheet({ index, onClose, onPick }: { index: number; onClose: () => void; onPick: (slot: Exclude<FrameSlot, null>) => Promise<void> }) {
  const [works, setWorks] = useState<WorkRecord[]>([])
  const [photos, setPhotos] = useState<PhotoRecord[]>([])

  useEffect(() => {
    void listWorks().then(setWorks)
    void listPhotos().then((rows) => setPhotos(rows.filter((photo) => !photo.id.startsWith('bg-'))))
  }, [])

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/45 p-4" onMouseDown={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-3xl bg-foam p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl">Cuadro {index + 1}</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-ink-soft hover:bg-paper">
            Cerrar
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">Colgá una obra al 100 % o una foto.</p>
        <label className="mt-4 inline-flex cursor-pointer rounded-full bg-ink px-4 py-2 text-sm text-foam">
          Subir foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void savePhoto(file).then((photo) => {
                emitSharedImage({ kind: 'photo', id: photo.id, name: photo.name, percent: 100, blob: photo.blob })
                void onPick({ kind: 'photo', id: photo.id })
              })
            }}
          />
        </label>
        <h3 className="mt-5 text-sm font-medium">Cajón</h3>
        <ul className="mt-2 space-y-1">
          {works.map((work) => {
            const complete = workIsComplete(work)
            return (
              <li key={work.id}>
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-paper disabled:cursor-not-allowed disabled:text-ink-soft disabled:hover:bg-transparent"
                  disabled={!complete}
                  title={complete ? 'Colgar esta obra' : 'Se cuelga al 100 %'}
                  onClick={() => {
                    if (!complete) return
                    void onPick({ kind: 'work', id: work.id })
                  }}
                >
                  {work.name}
                  <span className="ml-2 text-xs text-ink-soft">{workPercent(work)} %</span>
                </button>
              </li>
            )
          })}
          {works.length === 0 && <li className="text-sm text-ink-soft">El cajón está vacío.</li>}
          {works.length > 0 && works.every((work) => !workIsComplete(work)) && (
            <li className="px-3 text-xs text-ink-soft">Ninguna está al 100 % todavía.</li>
          )}
        </ul>
        {photos.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">Fotos</h3>
            <ul className="mt-2 space-y-1">
              {photos.map((photo) => (
                <li key={photo.id}>
                  <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => void onPick({ kind: 'photo', id: photo.id })}>
                    {photo.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
