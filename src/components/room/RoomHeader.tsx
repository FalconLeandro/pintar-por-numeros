import { useState, type FormEvent } from 'react'
import { ArrowLeft, DoorOpen, KeyRound } from 'lucide-react'
import { ThemeToggle } from '../ThemeToggle.tsx'
import { inviteUrl, useLiveStore } from '../../room/live.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'

export function RoomHeader({ title, back }: { title?: string; back?: boolean }) {
  const go = useRoomStore((state) => state.go)
  const role = useLiveStore((state) => state.role)
  const roomId = useLiveStore((state) => state.roomId)
  const roomName = useLiveStore((state) => state.roomName)
  const memberships = useLiveStore((state) => state.memberships)
  const changeKeyword = useLiveStore((state) => state.changeKeyword)
  const renameRoom = useLiveStore((state) => state.renameRoom)
  const openRoom = useLiveStore((state) => state.openRoom)
  const showCreate = useLiveStore((state) => state.showCreate)
  const showEnter = useLiveStore((state) => state.showEnter)
  const [panel, setPanel] = useState<'key' | 'rooms' | null>(null)
  const [keyword, setKeyword] = useState('')
  const [draftName, setDraftName] = useState(roomName)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const link = roomId ? inviteUrl(roomId) : ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await changeKeyword(keyword)
      setKeyword('')
      setNotice('Listo. La palabra nueva ya es la llave.')
      setPanel('key')
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
        <p className="truncate font-display text-lg leading-none sm:text-xl">My Room</p>
        <p className="truncate text-[11px] tracking-wide text-ink-soft">
          {[roomName || 'Mi habitación', title].filter(Boolean).join(' · ')}
        </p>
      </div>
      <button
        type="button"
        className="icon-action"
        onClick={() => {
          setCopied(false)
          setNotice('')
          setDraftName(roomName)
          setPanel((current) => (current === 'rooms' ? null : 'rooms'))
        }}
        aria-label="Habitaciones"
        title="Habitaciones"
      >
        <DoorOpen size={16} />
      </button>
      {role === 'owner' && (
        <button
          type="button"
          className="icon-action"
          onClick={() => {
            setNotice('')
            setPanel((current) => (current === 'key' ? null : 'key'))
          }}
          aria-label="Cambiar la palabra clave"
          title="Palabra clave"
        >
          <KeyRound size={16} />
        </button>
      )}
      <ThemeToggle />
      {panel === 'rooms' && roomId && (
        <div className="absolute top-16 right-3 z-40 w-80 rounded-3xl border border-line bg-foam p-4 shadow-xl">
          <p className="font-display text-lg">{roomName || 'Mi habitación'}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {role === 'owner'
              ? 'Este nombre es de la habitación. My Room es la app. Pasale el enlace y la palabra clave.'
              : 'Entraste como invitado. El nombre y la palabra los cambia quien la creó.'}
          </p>
          {role === 'owner' && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void renameRoom(draftName).then(() => setNotice('Listo. La habitación ya tiene ese nombre.')).catch((error: unknown) => {
                  setNotice(error instanceof Error ? error.message : 'No pude cambiar el nombre')
                })
              }}
            >
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                aria-label="Nombre de la habitación"
                className="min-w-0 flex-1 rounded-2xl border border-line bg-paper px-3 py-2 text-sm outline-none"
              />
              <button type="submit" className="studio-action" disabled={draftName.trim().length < 2 || draftName.trim() === roomName}>
                Guardar
              </button>
            </form>
          )}
          {role === 'owner' && notice && <p className="mt-2 text-xs text-ink-soft">{notice}</p>}
          <input readOnly value={link} className="mt-3 w-full rounded-2xl border border-line bg-paper px-3 py-2 text-xs outline-none" />
          <button
            type="button"
            className="studio-action mt-3"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false))
            }}
          >
            {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
          {memberships.length > 1 && (
            <div className="mt-4 flex flex-col gap-1">
              {memberships.filter((item) => item.id !== roomId).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="rounded-2xl px-3 py-2 text-left text-sm hover:bg-paper"
                  onClick={() => {
                    setPanel(null)
                    void openRoom(item.id)
                  }}
                >
                  {item.name} · {item.role === 'owner' ? 'tuya' : 'invitado'}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={showCreate}>
              Crear otra
            </button>
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={showEnter}>
              Entrar a otra
            </button>
          </div>
        </div>
      )}
      {panel === 'key' && (
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
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={() => setPanel(null)}>
              Cerrar
            </button>
          </div>
        </form>
      )}
    </header>
  )
}
