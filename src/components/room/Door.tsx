import { useState, type FormEvent } from 'react'
import { useLiveStore } from '../../room/live.ts'

function codeFromText(value: string) {
  const text = value.trim()
  try {
    const sala = new URL(text).searchParams.get('sala')
    if (sala && /^[a-z0-9]{8}$/i.test(sala)) return sala.toLowerCase()
  } catch {
    /* El texto no es un enlace. */
  }
  const code = text.toLowerCase()
  return /^[a-z0-9]{8}$/.test(code) ? code : ''
}

export function Door() {
  const mode = useLiveStore((state) => state.mode)
  const pendingCode = useLiveStore((state) => state.pendingCode)
  const error = useLiveStore((state) => state.error)
  const memberships = useLiveStore((state) => state.memberships)
  const createRoom = useLiveStore((state) => state.createRoom)
  const enter = useLiveStore((state) => state.enter)
  const openRoom = useLiveStore((state) => state.openRoom)
  const showCreate = useLiveStore((state) => state.showCreate)
  const showEnter = useLiveStore((state) => state.showEnter)
  const boot = useLiveStore((state) => state.boot)
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [codeText, setCodeText] = useState('')
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState('')
  const knownCode = pendingCode || codeFromText(codeText)
  const creating = mode === 'create'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setLocalError('')
    try {
      if (creating) await createRoom(keyword, name)
      else {
        if (!knownCode) throw new Error('El enlace no tiene una habitación.')
        await enter(keyword, knownCode)
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'No pude abrir la puerta')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid h-dvh place-items-center bg-paper px-4">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-3xl border border-line bg-foam p-6 shadow-xl">
        <p className="font-display text-3xl">My Room</p>
        <h1 className="mt-2 font-display text-2xl">{creating ? 'Crear mi habitación' : 'Entrar a una habitación'}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {creating
            ? 'My Room es la app. El nombre es solo de esta habitación. La palabra que elijas es la llave: este equipo queda como dueño y puede cambiarla cuando quiera.'
            : 'Pedile el enlace y la palabra a quien cuida esa habitación. Adentro se comparte la música, los juegos y las obras.'}
        </p>
        {creating ? (
          <label className="mt-5 block text-sm">
            Nombre de la habitación
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mi habitación"
              autoComplete="off"
              className="mt-1 w-full rounded-2xl border border-line bg-paper px-3 py-2 outline-none"
            />
          </label>
        ) : pendingCode ? (
          <p className="mt-5 text-sm text-ink-soft">Código {pendingCode}</p>
        ) : (
          <label className="mt-5 block text-sm">
            Enlace o código
            <input
              value={codeText}
              onChange={(event) => setCodeText(event.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-2xl border border-line bg-paper px-3 py-2 outline-none"
            />
          </label>
        )}
        <label className="mt-4 block text-sm">
          Palabra clave
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            autoFocus
            autoComplete="off"
            className="mt-1 w-full rounded-2xl border border-line bg-paper px-3 py-2 outline-none"
          />
        </label>
        {(localError || error) && <p className="mt-3 text-sm text-coral">{localError || error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" className="studio-action" disabled={pending || keyword.trim().length < 2 || (!creating && !knownCode)}>
            {creating ? 'Crear' : 'Entrar'}
          </button>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm text-ink-soft"
            onClick={() => (creating ? showEnter() : showCreate())}
          >
            {creating ? 'Tengo un enlace' : 'Crear la mía'}
          </button>
          {memberships[0] && (
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={() => void openRoom(memberships[0].id)}>
              Volver
            </button>
          )}
          {error && (
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-ink-soft" onClick={() => void boot()}>
              Reintentar
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
