import { useEffect, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { COLOR_OPTIONS, DETAIL_STOPS } from '../constants.ts'
import { usePaintStore } from '../store/usePaintStore.ts'

function isImageFile(file: File) {
  return file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp' || /\.(jpe?g|png|webp)$/i.test(file.name)
}

export function ImageUploaderModal() {
  const open = usePaintStore((state) => state.modalOpen)
  const token = usePaintStore((state) => state.project?.token ?? 0)
  if (!open) return null
  return <UploaderForm key={token} />
}

function UploaderForm() {
  const project = usePaintStore((state) => state.project)
  const globalFilled = usePaintStore((state) => state.globalFilled)
  const closeModal = usePaintStore((state) => state.closeModal)
  const processBitmap = usePaintStore((state) => state.processBitmap)
  const reprocess = usePaintStore((state) => state.reprocess)
  const setError = usePaintStore((state) => state.setError)

  const [file, setFile] = useState<File | null>(() => {
    const pending = usePaintStore.getState().pendingFile
    return pending && isImageFile(pending) ? pending : null
  })
  const [preview, setPreview] = useState<string | null>(() => (file ? URL.createObjectURL(file) : null))
  const [colors, setColors] = useState(() => usePaintStore.getState().project?.colorCount ?? 16)
  const [detail, setDetail] = useState(() => {
    const current = usePaintStore.getState().project
    const index = DETAIL_STOPS.findIndex((stop) => stop.pixels === current?.minRegion)
    return index >= 0 ? index : 2
  })
  const [over, setOver] = useState(false)

  useEffect(() => {
    const pending = usePaintStore.getState().pendingFile
    if (!pending) return
    if (!isImageFile(pending)) setError('Usá un archivo JPG, PNG o WEBP.')
    usePaintStore.getState().clearPendingFile()
  }, [setError])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function adopt(next: File) {
    if (!isImageFile(next)) {
      setError('Usá un archivo JPG, PNG o WEBP.')
      return
    }
    setFile(next)
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(next)
    })
  }

  async function onSubmit() {
    const minRegion = DETAIL_STOPS[detail]?.pixels ?? 25
    if (file) {
      try {
        const bitmap = await createImageBitmap(file)
        processBitmap(bitmap, file.name.replace(/\.[^.]+$/, ''), colors, minRegion)
        setFile(null)
        setPreview((current) => {
          if (current) URL.revokeObjectURL(current)
          return null
        })
      } catch {
        setError('No se pudo leer esa imagen.')
      }
      return
    }
    if (project) reprocess(colors, minRegion)
  }

  const stop = DETAIL_STOPS[detail]

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]" onMouseDown={() => closeModal()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-3xl bg-foam p-5 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const next = event.dataTransfer.files[0]
          if (next) adopt(next)
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="upload-title" className="font-display text-3xl leading-none">
              {project ? 'Nueva conversión' : 'Subir imagen'}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">JPG, PNG o WEBP. El lado mayor queda en 800 px para pintar a 60 fps.</p>
          </div>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-paper" onClick={() => closeModal()} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <label
          className={`mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center ${over ? 'border-studio bg-studio/5' : 'border-ink/20 bg-paper/60'}`}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOver(false)
            const next = event.dataTransfer.files[0]
            if (next) adopt(next)
          }}
        >
          {preview ? (
            <img src={preview} alt="Vista previa" className="max-h-52 rounded-xl object-contain" />
          ) : (
            <>
              <Upload size={22} className="text-studio" />
              <p className="mt-2 text-sm font-medium">Arrastrá una foto o elegila desde el equipo</p>
              <p className="mt-1 text-xs text-ink-soft">
                {project ? 'Si no subís otra, se vuelve a procesar la actual.' : 'También podés probar un ejemplo del estudio.'}
              </p>
            </>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0]
              if (next) adopt(next)
              event.target.value = ''
            }}
          />
        </label>

        <div className="mt-5">
          <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">Colores</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setColors(count)}
                className={`rounded-full px-3 py-1.5 text-sm ${colors === count ? 'bg-ink text-foam' : 'bg-paper text-ink'}`}
                aria-pressed={colors === count}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">Detalle</p>
            <p className="text-sm font-medium">{stop?.label}</p>
          </div>
          <input
            type="range"
            min={0}
            max={DETAIL_STOPS.length - 1}
            step={1}
            value={detail}
            onChange={(event) => setDetail(Number(event.target.value))}
            className="mt-3 w-full accent-studio"
            aria-label="Nivel de detalle"
          />
          <p className="text-xs text-ink-soft">
            {stop?.hint}. Las regiones de menos de {stop?.pixels} px se funden con el vecino de mayor borde.
          </p>
        </div>

        {project && !file && globalFilled > 0 && (
          <p className="mt-4 rounded-2xl bg-paper px-3 py-2 text-sm text-ink-soft">
            Volver a procesar reinicia el avance de esta pintura.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-full px-4 py-2 text-sm text-ink-soft hover:bg-paper" onClick={() => closeModal()}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-full bg-studio px-4 py-2 text-sm font-medium text-foam disabled:opacity-40"
            disabled={!file && !project}
            onClick={() => void onSubmit()}
          >
            {file || !project ? 'Convertir' : 'Volver a procesar'}
          </button>
        </div>
      </div>
    </div>
  )
}
