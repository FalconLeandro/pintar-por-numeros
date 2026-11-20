import { X } from 'lucide-react'
import { CollectionGallery } from './CollectionGallery.tsx'
import { usePaintStore } from '../store/usePaintStore.ts'

export function CollectionModal() {
  const open = usePaintStore((state) => state.collectionOpen)
  const closeCollection = usePaintStore((state) => state.closeCollection)
  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]" onMouseDown={() => closeCollection()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-title"
        className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-3xl bg-foam p-5 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="collection-title" className="font-display text-3xl leading-none">
              Mi colección
            </h2>
            <p className="mt-2 text-sm text-ink-soft">Elegí una pieza para convertirla en pintar por números.</p>
          </div>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-paper" onClick={() => closeCollection()} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <CollectionGallery />
      </div>
    </div>
  )
}
