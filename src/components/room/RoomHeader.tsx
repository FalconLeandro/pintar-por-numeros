import { ArrowLeft } from 'lucide-react'
import { ThemeToggle } from '../ThemeToggle.tsx'
import { useRoomStore } from '../../store/useRoomStore.ts'

export function RoomHeader({ title, back }: { title: string; back?: boolean }) {
  const go = useRoomStore((state) => state.go)
  return (
    <header className="flex h-16 items-center gap-2 border-b border-line bg-foam/90 px-3 backdrop-blur sm:px-4">
      {back && (
        <button type="button" className="icon-action" onClick={() => go('room')} aria-label="Volver a la habitación" title="Habitación">
          <ArrowLeft size={16} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg leading-none sm:text-xl">El Atelier de Memito</p>
        <p className="truncate text-[11px] tracking-wide text-ink-soft">{title}</p>
      </div>
      <ThemeToggle />
    </header>
  )
}
