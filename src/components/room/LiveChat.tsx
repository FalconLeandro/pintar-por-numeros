import { useEffect, useRef, useState } from 'react'
import { sendChat, useLiveStore } from '../../room/live.ts'

export function LiveChat() {
  const messages = useLiveStore((state) => state.messages)
  const role = useLiveStore((state) => state.role)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  return (
    <aside className="fixed inset-x-3 bottom-3 z-30 flex h-32 flex-col rounded-3xl border border-line bg-foam/95 shadow-xl backdrop-blur lg:inset-x-auto lg:top-3 lg:bottom-3 lg:left-3 lg:h-auto lg:w-80">
      <p className="px-3 pt-2 text-[11px] tracking-wide text-ink-soft uppercase">Charla</p>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2">
        {messages.length === 0 && <p className="text-xs text-ink-soft">La charla se borra cuando la habitación queda vacía.</p>}
        {messages.map((message) => {
          const mine = message.role === role
          return (
            <p key={message.id} className={`max-w-[90%] rounded-2xl px-3 py-1.5 text-sm ${mine ? 'ml-auto bg-ink text-foam' : 'bg-paper'}`}>
              <span className={`block text-[10px] tracking-wide uppercase ${mine ? 'text-foam/70' : 'text-ink-soft'}`}>
                {message.role === 'owner' ? 'Dueño' : 'Invitado'}
              </span>
              {message.text}
            </p>
          )
        })}
      </div>
      <form
        className="flex gap-2 px-2 pb-2"
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft.trim()
          if (!text || sending) return
          const previous = draft
          setDraft('')
          setSending(true)
          void sendChat(text)
            .catch((error: unknown) => {
              setDraft(previous)
              useLiveStore.setState({ error: error instanceof Error ? error.message : 'No pude enviar el mensaje.' })
            })
            .finally(() => setSending(false))
        }}
      >
        <input
          value={draft}
          maxLength={240}
          placeholder="Escribí acá"
          aria-label="Mensaje"
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3 py-1.5 text-sm outline-none"
        />
        <button type="submit" className="studio-action" disabled={sending || draft.trim().length === 0}>
          Enviar
        </button>
      </form>
    </aside>
  )
}
