import { Archive, Download, Eye, Home, ImagePlus, Library, LocateFixed, Redo2, SlidersHorizontal, Undo2 } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle.tsx'
import { exportPainting } from '../utils/exportPng.ts'
import { useLiveStore } from '../room/live.ts'
import { usePaintStore } from '../store/usePaintStore.ts'
import { useRoomStore } from '../store/useRoomStore.ts'

export function TopBar() {
  const project = usePaintStore((state) => state.project)
  const roomName = useLiveStore((state) => state.roomName)
  const globalFilled = usePaintStore((state) => state.globalFilled)
  const canUndo = usePaintStore((state) => state.canUndo)
  const canRedo = usePaintStore((state) => state.canRedo)
  const openModal = usePaintStore((state) => state.openModal)
  const openCollection = usePaintStore((state) => state.openCollection)
  const setCompareHeld = usePaintStore((state) => state.setCompareHeld)
  const requestHint = usePaintStore((state) => state.requestHint)
  const saveToDrawer = usePaintStore((state) => state.saveToDrawer)
  const undo = usePaintStore((state) => state.undo)
  const redo = usePaintStore((state) => state.redo)
  const setError = usePaintStore((state) => state.setError)

  const total = project?.pixelCount ?? 0
  const percent = total > 0 ? Math.round((globalFilled / total) * 100) : 0
  const done = total > 0 && globalFilled >= total

  async function onExport() {
    const current = usePaintStore.getState()
    if (!current.project || !current.painted) return
    try {
      await exportPainting(current.project, current.painted)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo exportar')
    }
  }

  return (
    <header className="border-b border-line bg-foam/90 backdrop-blur">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-display text-lg text-foam">
            3
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-none sm:text-xl">My Room</p>
              <p className="truncate text-[11px] tracking-wide text-ink-soft">
                {[roomName || 'Mi habitación', project ? project.name : 'Pintar por números'].join(' · ')}
              </p>
            </div>
            <BlackCat />
          </div>
        </div>

        <div className="mx-2 hidden min-w-0 flex-1 md:block">
          <Progress percent={percent} done={done} regions={project ? project.regions.length - 1 : 0} />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button type="button" className="icon-action" onClick={() => useRoomStore.getState().go('room')} aria-label="Volver a la habitación" title="Habitación">
            <Home size={16} />
          </button>
          <ThemeToggle />
          <button type="button" className="studio-action collection-action" onClick={() => openCollection()}>
            <Library size={16} />
            <span className="hidden sm:inline">Mi colección</span>
          </button>
          <button type="button" className="studio-action" onClick={() => openModal()}>
            <ImagePlus size={16} />
            <span className="hidden sm:inline">{project ? 'Nueva' : 'Subir'}</span>
          </button>
          <button type="button" className="icon-action" onClick={() => openModal()} disabled={!project} title="Ajustes de conversión">
            <SlidersHorizontal size={16} />
          </button>
          <button type="button" className="icon-action" onClick={() => requestHint()} disabled={!project} title="Pista: ir a una región sin pintar">
            <LocateFixed size={16} />
          </button>
          <button
            type="button"
            className="icon-action"
            disabled={!project}
            title="Mantené presionado para ver la foto"
            aria-label="Ver original"
            onPointerDown={(event) => {
              if (!project) return
              event.currentTarget.setPointerCapture(event.pointerId)
              setCompareHeld(true)
            }}
            onPointerUp={() => setCompareHeld(false)}
            onPointerCancel={() => setCompareHeld(false)}
          >
            <Eye size={16} />
          </button>
          <button type="button" className="icon-action" onClick={() => void saveToDrawer()} disabled={!project} title="Guardar en el cajón" aria-label="Guardar en el cajón">
            <Archive size={16} />
          </button>
          <button type="button" className="icon-action" onClick={() => void onExport()} disabled={!project} title="Exportar PNG sin bordes ni números">
            <Download size={16} />
          </button>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          <button type="button" className="icon-action" onClick={() => undo()} disabled={!canUndo} title="Deshacer (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-action" onClick={() => redo()} disabled={!canRedo} title="Rehacer (Ctrl+Shift+Z)">
            <Redo2 size={16} />
          </button>
        </div>
      </div>
      <div className="px-3 pb-3 md:hidden">
        <Progress percent={percent} done={done} regions={project ? project.regions.length - 1 : 0} />
      </div>
    </header>
  )
}

export function BlackCat() {
  return (
    <svg className="memito-cat h-11 w-[3.35rem] shrink-0" viewBox="0 0 78 52" aria-hidden="true">
      <g className="cat-sit">
        <path
          className="cat-tail"
          d="M50 34c9 2 18-4 17-13-1-7-8-10-11-4"
          fill="none"
          stroke="#161311"
          strokeWidth="5.2"
          strokeLinecap="round"
        />
        <ellipse cx="42" cy="37" rx="16" ry="9" fill="#161311" />
        <ellipse cx="34" cy="43.2" rx="4.2" ry="2.3" fill="#161311" />
        <ellipse cx="45" cy="43.6" rx="4.2" ry="2.3" fill="#161311" />
        <g className="cat-head">
          <circle cx="26" cy="23" r="12" fill="#161311" />
          <path className="cat-ear" d="M16 16.5 20.2 5.2 27.2 15.6z" fill="#161311" />
          <path d="M27 15.2 33.4 4.4 37.6 16.4z" fill="#161311" />
          <path d="M18.2 13.6 20.4 8.2 24.2 14.2z" fill="#d9899c" />
          <path d="M29.4 12.4 32.4 7.2 35.6 13.6z" fill="#d9899c" />
          <g className="cat-eye">
            <ellipse cx="21.4" cy="23.2" rx="1.8" ry="2.25" fill="#f3c56b" />
            <ellipse cx="21.2" cy="23.6" rx="0.75" ry="1.25" fill="#161311" />
          </g>
          <g className="cat-eye cat-eye-late">
            <ellipse cx="30.2" cy="23.2" rx="1.8" ry="2.25" fill="#f3c56b" />
            <ellipse cx="30" cy="23.6" rx="0.75" ry="1.25" fill="#161311" />
          </g>
          <path d="M24.6 26.6 26.1 28.3 27.7 26.6z" fill="#e7a0b0" />
          <path d="M25.2 28.6c.7.7 1.6.7 2.3 0" fill="none" stroke="#f6d8c8" strokeWidth="0.7" strokeLinecap="round" />
        </g>
        <path
          d="M16 24.5H6.5M16.6 27.4H5.5M35.6 24.8h9M35.2 27.6h10"
          fill="none"
          className="cat-whisker"
          stroke="#4a4038"
          strokeWidth="0.75"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}

function Progress({ percent, done, regions }: { percent: number; done: boolean; regions: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-deep">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${done ? 'bg-studio' : 'bg-coral'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="shrink-0 text-xs font-medium tabular-nums text-ink-soft">
        {done ? 'Completo' : `${percent}%`}
        {regions > 0 && <span className="hidden lg:inline"> · {regions.toLocaleString('es-AR')} regiones</span>}
      </p>
    </div>
  )
}
