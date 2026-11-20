import { useState } from 'react'
import { COLLECTION, type CollectionPiece } from '../utils/collection.ts'
import { usePaintStore } from '../store/usePaintStore.ts'

export function CollectionGallery() {
  const processBitmap = usePaintStore((state) => state.processBitmap)
  const setError = usePaintStore((state) => state.setError)
  const closeCollection = usePaintStore((state) => state.closeCollection)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function start(piece: CollectionPiece) {
    if (busyId) return
    setBusyId(piece.id)
    try {
      const response = await fetch(piece.src)
      if (!response.ok) throw new Error('missing')
      const bitmap = await createImageBitmap(await response.blob())
      closeCollection()
      processBitmap(bitmap, piece.title, piece.colors, piece.minRegion)
    } catch {
      setBusyId(null)
      setError('No se pudo abrir esa pieza de la colección.')
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {COLLECTION.map((piece) => (
        <button
          key={piece.id}
          type="button"
          disabled={busyId !== null}
          onClick={() => void start(piece)}
          className="group overflow-hidden rounded-3xl border border-line bg-paper text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:translate-y-0 disabled:opacity-70"
        >
          <img src={piece.src} alt="" className="aspect-[4/3] w-full object-cover" />
          <span className="flex items-end justify-between gap-3 p-3">
            <span>
              <span className="block font-display text-lg leading-none">{piece.title}</span>
              <span className="mt-1 block text-xs text-ink-soft">{piece.subtitle}</span>
            </span>
            <span className="shrink-0 rounded-full bg-studio px-3 py-1.5 text-xs font-medium text-foam">
              {busyId === piece.id ? 'Abriendo' : 'Pintar'}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
