import { useEffect, useState } from 'react'
import { RoomHeader } from './RoomHeader.tsx'
import { useRoomStore } from '../../store/useRoomStore.ts'
import { deleteWork, listWorks, loadFrames, saveFrames, type FrameSlot, type WorkRecord } from '../../utils/roomDb.ts'

export function DrawerView() {
  const worksVersion = useRoomStore((state) => state.worksVersion)
  const bumpWorks = useRoomStore((state) => state.bumpWorks)
  const bumpFrames = useRoomStore((state) => state.bumpFrames)
  const [works, setWorks] = useState<Array<WorkRecord & { url: string }>>([])

  useEffect(() => {
    let cancel = false
    const urls: string[] = []
    void listWorks().then((rows) => {
      if (cancel) return
      setWorks(
        rows.map((row) => {
          const url = URL.createObjectURL(row.blob)
          urls.push(url)
          return { ...row, url }
        }),
      )
    })
    return () => {
      cancel = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [worksVersion])

  async function hang(workId: string, slotIndex: number) {
    const frames = await loadFrames()
    const next: FrameSlot[] = frames.map((slot, index) => (index === slotIndex ? { kind: 'work', id: workId } : slot))
    await saveFrames(next)
    bumpFrames()
  }

  async function remove(id: string) {
    await deleteWork(id)
    bumpWorks()
    bumpFrames()
  }

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <RoomHeader title="Cajón de dibujos" back />
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-4 py-6 pb-36">
        <h1 className="font-display text-3xl">Cajón de dibujos</h1>
        <p className="mt-1 text-sm text-ink-soft">Acá quedan las obras terminadas. Podés colgarlas en un cuadro de la pared.</p>
        {works.length === 0 ? (
          <p className="mt-8 rounded-3xl border border-dashed border-line bg-foam px-5 py-8 text-sm text-ink-soft">
            El cajón está vacío. Cuando una pintura llegue al 100 %, se guarda sola.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {works.map((work) => (
              <article key={work.id} className="overflow-hidden rounded-3xl border border-line bg-foam shadow-sm">
                <img src={work.url} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="space-y-3 p-3">
                  <div>
                    <h2 className="font-display text-lg leading-none">{work.name}</h2>
                    <p className="mt-1 text-xs text-ink-soft">{new Date(work.createdAt).toLocaleDateString('es-AR')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2].map((slot) => (
                      <button key={slot} type="button" className="rounded-full bg-studio px-3 py-1.5 text-xs font-medium text-foam" onClick={() => void hang(work.id, slot)}>
                        Cuadro {slot + 1}
                      </button>
                    ))}
                    <button type="button" className="rounded-full px-3 py-1.5 text-xs text-ink-soft hover:bg-paper" onClick={() => void remove(work.id)}>
                      Sacar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
