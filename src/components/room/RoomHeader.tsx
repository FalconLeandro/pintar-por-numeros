import { useState, type FormEvent } from 'react'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { ThemeToggle } from '../ThemeToggle.tsx'
import { useLiveStore } from '../../room/live.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'

export function RoomHeader({ title, back }: { title: string; back?: boolean }) {
  const go = useRoomStore((state) => state.go)
  const role = useLiveStore((state) => state.role)
  const changeKeyword = useLiveStore((state) => state.changeKeyword)
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await changeKeyword(keyword)
      setKeyword('')
      setNotice('Listo. La palabra nueva ya es la llave.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No pude cambiarla')
    }
  }

  return (
    <header className="relative flex h-16 items-center gap-2 border-b border-line bg-foam/90 px-3 backdrop-blur sm:px-4">
      {back && (
        <button type="button" className="icon-action" onClick={() => go('room')} aria-label="Volver a la habitación" title="Habitación">
          <ArrowLeft size={16} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg leading-none sm:text-xl">El Atelier de Memito</p>
        <p className="truncate text-[11px] tracking-wide text-ink-soft">{title}</p>
      </div>
      {role === 'owner' && (
        <button type="button" className="icon-action" onClick={() => setOpen(true)} aria-label="Cambiar la palabra clave" title="Palabra clave">
          <KeyRound size={16} />
        </button>
      )}
      <ThemeToggle />
      {open && (
        <form onSubmit={(event) => void submit(event)} className="absolute top-16 right-3 z-40 w-72 rounded-3xl border border-line bg-foam p-4 shadow-xl">
          <p className="font-display text-lg">Palabra clave</p>
          <p className="mt-1 text-xs text-ink-soft">Quien no la sepa no entra. Los invitados que ya estaban tienen que volver a pedirla.</p>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            autoComplete="off"
            className="mt-3 w-full rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none"
          />
          {notice && <p className="mt-2 text-xs text-ink-soft">{notice}</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" className="studio-action" disabled={keyword.trim().length < 2}>
              Cambiar
            </button>
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={() => setOpen(false)}>
              Cerrar
            </button>
          </div>
        </form>
      )}
    </header>
  )
}
