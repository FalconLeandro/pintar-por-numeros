import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace.tsx'
import { ColorPalette } from './components/ColorPalette.tsx'
import { CollectionModal } from './components/CollectionModal.tsx'
import { ImageUploaderModal } from './components/ImageUploaderModal.tsx'
import { CrosswordView } from './components/room/CrosswordView.tsx'
import { DrawerView } from './components/room/DrawerView.tsx'
import { RecordPlayer } from './components/room/RecordPlayer.tsx'
import { RoomScene } from './components/room/RoomScene.tsx'
import { TopBar } from './components/TopBar.tsx'
import { Door } from './components/room/Door.tsx'
import { LiveChat } from './components/room/LiveChat.tsx'
import { useLiveStore } from './room/live.ts'
import { usePaintStore } from './store/usePaintStore.ts'
import { useRoomStore } from './store/useRoomStore.ts'

export default function App() {
  const hydrated = usePaintStore((state) => state.hydrated)
  const project = usePaintStore((state) => state.project)
  const processing = usePaintStore((state) => state.processing)
  const restored = usePaintStore((state) => state.restored)
  const error = usePaintStore((state) => state.error)
  const notice = usePaintStore((state) => state.notice)
  const place = useRoomStore((state) => state.place)
  const sessionReady = useLiveStore((state) => state.ready)
  const admitted = useLiveStore((state) => state.admitted)
  const palette = useLiveStore((state) => state.look.palette)
  const boot = useLiveStore((state) => state.boot)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const store = usePaintStore.getState()
      const room = useRoomStore.getState()
      if (event.key === 'Escape') {
        if (room.place === 'paint' && store.processing) store.cancelProcessing()
        else if (room.place === 'paint' && store.collectionOpen) store.closeCollection()
        else if (room.place === 'paint' && store.modalOpen) store.closeModal()
        else if (room.playerOpen) room.setPlayerOpen(false)
        else if (room.place !== 'room') room.go('room')
        return
      }
      if (room.place !== 'paint') return
      if (typing(event.target) || store.modalOpen || store.collectionOpen || store.processing) return
      if (event.code === 'Space') {
        if (event.target instanceof HTMLElement && event.target.closest('button, a')) return
        event.preventDefault()
        store.setSpaceHeld(true)
        return
      }
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      if (meta) return
      if (key === '[') store.nudgeColor(-1)
      else if (key === ']') store.nudgeColor(1)
      else if (key === 'b') store.setTool('brush')
      else if (key === 'h') store.setTool('hand')
      else if (key === 'f') store.issueCommand('fit')
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') usePaintStore.getState().setSpaceHeld(false)
    }
    const clearSpace = () => usePaintStore.getState().setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearSpace)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearSpace)
    }
  }, [])

  if (!hydrated || !sessionReady) {
    return (
      <div className="grid h-dvh place-items-center bg-paper">
        <div className="text-center">
          <p className="font-display text-4xl">My Room</p>
          <p className="mt-2 text-sm text-ink-soft">Preparando la habitación…</p>
        </div>
      </div>
    )
  }

  if (!admitted) return <Door />

  return (
    <div
      data-room-palette={palette}
      className="relative flex h-dvh flex-col pb-36 lg:pb-0 lg:pl-[22rem]"
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        if ([...event.dataTransfer.types].includes('Files')) setDragOver(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragOver(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        const file = event.dataTransfer.files[0]
        if (file) {
          useRoomStore.getState().go('paint')
          usePaintStore.getState().queueFile(file)
        }
      }}
    >
      {place === 'room' && <RoomScene />}
      {place === 'drawer' && <DrawerView />}
      {place === 'crossword' && <CrosswordView />}
      {place === 'paint' && (
        <>
          <TopBar />
          {restored && project && (
            <div className="flex items-center justify-between gap-3 bg-studio px-4 py-2 text-sm text-foam">
              <p>Recuperamos la pintura guardada en este navegador.</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-full px-3 py-1 hover:bg-white/10" onClick={() => usePaintStore.getState().dismissRestored()}>
                  Seguir
                </button>
                <button type="button" className="rounded-full bg-foam px-3 py-1 text-ink" onClick={() => usePaintStore.getState().discard()}>
                  Descartar
                </button>
              </div>
            </div>
          )}
          <CanvasWorkspace />
          <ColorPalette />
          <ImageUploaderModal />
          <CollectionModal />
        </>
      )}
      <RecordPlayer />
      <LiveChat />

      {processing && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-ink/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl bg-foam p-6 shadow-2xl" aria-live="polite">
            <p className="font-display text-3xl">Convirtiendo</p>
            <p className="mt-2 text-sm text-ink-soft">{processing.stage}</p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-paper-deep">
              <div className="h-full rounded-full bg-studio transition-[width] duration-300" style={{ width: `${processing.pct}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="tabular-nums text-ink-soft">{processing.pct}%</span>
              <button type="button" className="text-ink-soft hover:text-ink" onClick={() => usePaintStore.getState().cancelProcessing()}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 px-4">
        {error && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink px-4 py-2 text-sm text-foam shadow-lg">
            <span>{error}</span>
            <button type="button" aria-label="Cerrar aviso" onClick={() => usePaintStore.getState().dismissError()}>
              <X size={14} />
            </button>
          </div>
        )}
        {notice && (
          <div className="pointer-events-auto rounded-full bg-studio px-4 py-2 text-sm text-foam shadow-lg">{notice}</div>
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-studio bg-foam/80">
          <p className="font-display text-3xl">Soltá la imagen</p>
        </div>
      )}
    </div>
  )
}
