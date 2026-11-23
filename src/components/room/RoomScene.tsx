import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Disc3, Frame, Paintbrush } from 'lucide-react'
import { BlackCat } from '../TopBar.tsx'
import { RoomHeader } from './RoomHeader.tsx'
import { usePaintStore } from '../../store/usePaintStore.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'
import {
  getPhoto,
  getWork,
  listPhotos,
  listWorks,
  loadFrames,
  saveFrames,
  savePhoto,
  type FrameSlot,
  type PhotoRecord,
  type WorkRecord,
} from '../../utils/roomDb.ts'

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
  const [frames, setFrames] = useState<Array<FrameView | null>>([null, null, null])
  const [editing, setEditing] = useState<number | null>(null)
  const [viewing, setViewing] = useState<FrameView | null>(null)

  useEffect(() => {
    if (editing === null && !viewing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      if (viewing) setViewing(null)
      else setEditing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing, viewing])

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

  return (
    <div className="relative flex h-dvh flex-col bg-paper">
      <RoomHeader title="La habitación" />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-auto px-4 py-5 pb-36">
        <p className="text-xs font-medium tracking-[0.22em] text-studio uppercase">Habitación</p>
        <h1 className="mt-2 max-w-xl font-display text-4xl leading-tight">
          Un lugar para quedarse un rato.
        </h1>
        <section className="relative mt-6 rounded-t-[2rem] border border-b-0 border-line bg-paper-deep px-4 pt-6 pb-8">
          <div className="grid gap-4 sm:grid-cols-3">
            {frames.map((frame, index) => (
              <button
                key={index}
                type="button"
                onClick={() => (frame ? setViewing(frame) : setEditing(index))}
                className="group mx-auto flex w-full max-w-56 flex-col items-center"
              >
                <span className="block w-full rounded-md border-[10px] border-ink bg-foam p-2 shadow-lg">
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
        <section className="rounded-b-[2rem] border border-line bg-ink/10 px-4 py-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <FloorButton icon={<Paintbrush size={18} />} label="Caballete" detail={project ? `Seguir ${project.name}` : 'Pintar por números'} onClick={() => { setPlayerOpen(false); usePaintStore.getState().dismissRestored(); go('paint') }} />
            <FloorButton icon={<Frame size={18} />} label="Cajón" detail="Obras terminadas" onClick={() => { setPlayerOpen(false); go('drawer') }} />
            <FloorButton icon={<Disc3 size={18} />} label="Tocadiscos" detail="Música de fondo" onClick={() => setPlayerOpen(true)} />
            <FloorButton icon={<BookOpen size={18} />} label="Crucigrama" detail="Sobre la mesa" onClick={() => { setPlayerOpen(false); go('crossword') }} />
          </div>
          <div className="mt-4 flex items-end justify-between">
            <BlackCat />
            <p className="max-w-xs text-right text-xs text-ink-soft">La gata se queda. La música también, si la dejás sonando.</p>
          </div>
        </section>
      </div>
      {editing !== null && (
        <FrameSheet
          index={editing}
          onClose={() => setEditing(null)}
          onPick={async (slot) => {
            const next = await loadFrames()
            next[editing] = slot
            await saveFrames(next)
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
    </div>
  )
}

function FloorButton({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-3xl border border-line bg-foam px-4 py-4 text-left shadow-sm hover:-translate-y-0.5 hover:shadow-md">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-paper text-ink">{icon}</span>
      <span className="mt-3 block font-display text-xl leading-none">{label}</span>
      <span className="mt-1 block truncate text-xs text-ink-soft">{detail}</span>
    </button>
  )
}

function FrameSheet({ index, onClose, onPick }: { index: number; onClose: () => void; onPick: (slot: Exclude<FrameSlot, null>) => Promise<void> }) {
  const [works, setWorks] = useState<WorkRecord[]>([])
  const [photos, setPhotos] = useState<PhotoRecord[]>([])

  useEffect(() => {
    void listWorks().then(setWorks)
    void listPhotos().then(setPhotos)
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
        <p className="mt-1 text-sm text-ink-soft">Colgá una obra del cajón o una foto.</p>
        <label className="mt-4 inline-flex cursor-pointer rounded-full bg-ink px-4 py-2 text-sm text-foam">
          Subir foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void savePhoto(file).then((photo) => onPick({ kind: 'photo', id: photo.id }))
            }}
          />
        </label>
        <h3 className="mt-5 text-sm font-medium">Cajón</h3>
        <ul className="mt-2 space-y-1">
          {works.map((work) => (
            <li key={work.id}>
              <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => void onPick({ kind: 'work', id: work.id })}>
                {work.name}
              </button>
            </li>
          ))}
          {works.length === 0 && <li className="text-sm text-ink-soft">Todavía no hay obras terminadas.</li>}
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
