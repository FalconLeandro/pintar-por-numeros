import { useState, type ReactNode } from 'react'
import { publishFrames, publishImage, useLiveStore } from '../../room/live.ts'
import { backgroundId, type FrameStyle, type RoomCat, type RoomLayout, type RoomPalette, type RoomSize } from '../../room/look.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'
import { cacheSharedRecord, loadFrames, saveFrames } from '../../utils/roomDb.ts'

const LAYOUTS: { id: RoomLayout; label: string }[] = [
  { id: 'clasica', label: 'Clásica' },
  { id: 'ancha', label: 'Ancha' },
  { id: 'torre', label: 'Torre' },
]
const SIZES: { id: RoomSize; label: string }[] = [
  { id: 'chico', label: 'Chico' },
  { id: 'mediano', label: 'Mediano' },
  { id: 'grande', label: 'Grande' },
]
const PALETTES: { id: RoomPalette; label: string; swatch: string }[] = [
  { id: 'papel', label: 'Papel', swatch: '#efe6d6' },
  { id: 'noche', label: 'Noche', swatch: '#14110e' },
  { id: 'rosa', label: 'Rosa', swatch: '#e7a0b0' },
  { id: 'salvia', label: 'Salvia', swatch: '#7dba96' },
  { id: 'mar', label: 'Mar', swatch: '#7eb6cc' },
]
const STYLES: { id: FrameStyle; label: string }[] = [
  { id: 'tinta', label: 'Tinta' },
  { id: 'linea', label: 'Línea' },
  { id: 'madera', label: 'Madera' },
  { id: 'oro', label: 'Oro' },
]
const CATS: { id: RoomCat; label: string }[] = [
  { id: 'negra', label: 'Negra' },
  { id: 'blanca', label: 'Blanca' },
  { id: 'ninguna', label: 'Ninguna' },
]

export function RoomLookSheet({ onClose }: { onClose: () => void }) {
  const look = useLiveStore((state) => state.look)
  const setLook = useLiveStore((state) => state.setLook)
  const roomId = useLiveStore((state) => state.roomId)
  const bumpFrames = useRoomStore((state) => state.bumpFrames)
  const bumpWorks = useRoomStore((state) => state.bumpWorks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setFrameCount(count: number) {
    const slots = await loadFrames()
    const next = Array.from({ length: count }, (_, index) => slots[index] ?? null)
    await saveFrames(next)
    setLook({ frameCount: count })
    void publishFrames()
    bumpFrames()
  }

  async function chooseBackground(file: File) {
    if (!roomId) return
    setBusy(true)
    setError(null)
    try {
      const blob = await shrinkImage(file)
      const id = backgroundId(roomId)
      await cacheSharedRecord('photo', id, 'Fondo', 100, blob)
      bumpWorks()
      await publishImage('photo', id, 'Fondo', 100, blob)
      setLook({ background: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pude guardar el fondo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/45 p-4" onMouseDown={onClose}>
      <div className="max-h-[86vh] w-full max-w-lg overflow-auto rounded-3xl bg-foam p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl">Personalizar</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-ink-soft hover:bg-paper">
            Cerrar
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">Lo que elijas lo ve quien entra. El claro y el oscuro siguen siendo de cada equipo.</p>

        <Field label="Disposición">
          <Choices value={look.layout} options={LAYOUTS} onPick={(layout) => setLook({ layout })} />
        </Field>
        <Field label="Tamaño">
          <Choices value={look.size} options={SIZES} onPick={(size) => setLook({ size })} />
        </Field>
        <Field label="Paleta">
          <div className="flex flex-wrap gap-2">
            {PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                onClick={() => setLook({ palette: palette.id })}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${look.palette === palette.id ? 'border-ink bg-paper' : 'border-line'}`}
              >
                <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: palette.swatch }} />
                {palette.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Fondo">
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer rounded-full bg-ink px-4 py-2 text-sm text-foam ${busy ? 'opacity-40' : ''}`}>
              {busy ? 'Guardando…' : look.background ? 'Cambiar imagen' : 'Elegir imagen'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void chooseBackground(file)
                }}
              />
            </label>
            {look.background && (
              <button type="button" className="rounded-full px-4 py-2 text-sm text-ink-soft hover:bg-paper" onClick={() => setLook({ background: false })}>
                Quitar
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-coral">{error}</p>}
        </Field>
        <Field label="Cuadros en la pared">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => void setFrameCount(count)}
                className={`grid h-9 w-9 place-items-center rounded-full border text-sm ${look.frameCount === count ? 'border-ink bg-ink text-foam' : 'border-line'}`}
              >
                {count}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Marco">
          <Choices value={look.frameStyle} options={STYLES} onPick={(frameStyle) => setLook({ frameStyle })} />
        </Field>
        <Field label="Frase de bienvenida">
          <input
            value={look.welcome}
            maxLength={80}
            onChange={(event) => setLook({ welcome: event.target.value })}
            className="w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none"
          />
        </Field>
        <Field label="Dedicatoria">
          <input
            value={look.dedication}
            maxLength={120}
            placeholder="Una línea en la pared"
            onChange={(event) => setLook({ dedication: event.target.value })}
            className="w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none"
          />
        </Field>
        <Field label="Qué hay en la habitación">
          <div className="flex flex-wrap gap-2">
            <Toggle label="Caballete" on={look.objects.easel} onClick={() => setLook({ objects: { ...look.objects, easel: !look.objects.easel } })} />
            <Toggle label="Cajón" on={look.objects.drawer} onClick={() => setLook({ objects: { ...look.objects, drawer: !look.objects.drawer } })} />
            <Toggle label="Tocadiscos" on={look.objects.player} onClick={() => setLook({ objects: { ...look.objects, player: !look.objects.player } })} />
            <Toggle label="Crucigrama" on={look.objects.crossword} onClick={() => setLook({ objects: { ...look.objects, crossword: !look.objects.crossword } })} />
          </div>
        </Field>
        <Field label="La gata">
          <Choices value={look.cat} options={CATS} onPick={(cat) => setLook({ cat })} />
        </Field>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium">{label}</p>
      {children}
    </div>
  )
}

function Choices<T extends string>({ value, options, onPick }: { value: T; options: { id: T; label: string }[]; onPick: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onPick(option.id)}
          className={`rounded-full border px-3 py-1.5 text-sm ${value === option.id ? 'border-ink bg-ink text-foam' : 'border-line'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-ink bg-paper' : 'border-line text-ink-soft'}`}>
      {label}
    </button>
  )
}

function shrinkImage(file: File) {
  return new Promise<Blob>((resolve, reject) => {
    void createImageBitmap(file)
      .then((bitmap) => {
        const maxSide = 1600
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          bitmap.close()
          reject(new Error('No pude preparar el fondo.'))
          return
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('No pude preparar el fondo.'))), 'image/jpeg', 0.82)
      })
      .catch(() => reject(new Error('No pude leer esa imagen.')))
  })
}
