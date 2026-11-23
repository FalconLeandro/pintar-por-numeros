import { useState, type FormEvent } from 'react'
import { useLiveStore } from '../../room/live.ts'

export function Door() {
  const exists = useLiveStore((state) => state.exists)
  const error = useLiveStore((state) => state.error)
  const createRoom = useLiveStore((state) => state.createRoom)
  const enter = useLiveStore((state) => state.enter)
  const boot = useLiveStore((state) => state.boot)
  const [keyword, setKeyword] = useState('')
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setLocalError('')
    try {
      if (exists) await enter(keyword)
      else await createRoom(keyword)
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'No pude abrir la puerta')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid h-dvh place-items-center bg-paper px-4">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-3xl border border-line bg-foam p-6 shadow-xl">
        <p className="font-display text-3xl">El Atelier de Memito</p>
        <h1 className="mt-2 font-display text-2xl">{exists ? 'La habitación está cerrada' : 'Crear la habitación'}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {exists
            ? 'Pedile la palabra clave a quien la cuida. Adentro se comparte la música, los juegos y las obras.'
            : 'La palabra que elijas es la llave. Este equipo queda como dueño y puede cambiarla cuando quiera.'}
        </p>
        <label className="mt-5 block text-sm">
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
        <div className="mt-5 flex gap-2">
          <button type="submit" className="studio-action" disabled={pending || keyword.trim().length < 2}>
            {exists ? 'Entrar' : 'Crear'}
          </button>
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
