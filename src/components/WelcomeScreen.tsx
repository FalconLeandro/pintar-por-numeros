import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { CollectionGallery } from './CollectionGallery.tsx'
import { DEMOS, paintDemo, renderDemo, type DemoId } from '../utils/demoImages.ts'
import { usePaintStore } from '../store/usePaintStore.ts'

export function WelcomeScreen() {
  const openModal = usePaintStore((state) => state.openModal)
  const processBitmap = usePaintStore((state) => state.processBitmap)

  async function startDemo(id: DemoId) {
    const demo = DEMOS.find((item) => item.id === id)
    if (!demo) return
    const bitmap = await createImageBitmap(renderDemo(id))
    processBitmap(bitmap, demo.title, demo.colors, demo.minRegion)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-5 py-10">
        <p className="text-xs font-medium tracking-[0.22em] text-studio uppercase">Estudio</p>
        <h1 className="mt-2 max-w-xl font-display text-4xl leading-tight sm:text-5xl">
          Una foto, una paleta, un número por cada mancha.
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-soft sm:text-base">
          Subí una imagen o probá un estudio ya armado. La conversión corre en segundo plano: cuantiza el color,
          separa las regiones y deja el número en el centro de cada una.
        </p>
        <button
          type="button"
          onClick={() => openModal()}
          className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-foam"
        >
          <Sparkles size={16} />
          Subir una imagen
        </button>

        <h2 className="mt-10 font-display text-2xl">Mi colección</h2>
        <p className="mt-1 mb-4 text-sm text-ink-soft">Las piezas que guardaste para pintar.</p>
        <CollectionGallery />

        <h2 className="mt-10 font-display text-2xl">Estudios de prueba</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {DEMOS.map((demo) => (
            <article key={demo.id} className="overflow-hidden rounded-3xl border border-line bg-foam shadow-sm">
              <DemoThumb id={demo.id} />
              <div className="flex items-end justify-between gap-3 p-4">
                <div>
                  <h2 className="font-display text-xl leading-none">{demo.title}</h2>
                  <p className="mt-1 text-xs text-ink-soft">{demo.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void startDemo(demo.id)}
                  className="shrink-0 rounded-full bg-studio px-3 py-1.5 text-xs font-medium text-foam"
                >
                  Probar
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

function DemoThumb({ id }: { id: DemoId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    paintDemo(ctx, id, canvas.width, canvas.height)
  }, [id])

  return <canvas ref={ref} width={640} height={400} className="aspect-[16/10] h-auto w-full" />
}
