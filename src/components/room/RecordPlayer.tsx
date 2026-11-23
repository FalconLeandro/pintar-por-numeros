import { memo, useCallback, useRef, useState, type FormEvent } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { useRoomStore } from '../../store/useRoomStore.ts'
import { saveTracks } from '../../utils/roomDb.ts'
import { videoIdFromInput, videoTitle } from '../../utils/youtube.ts'

interface YtPlayer {
  loadVideoById: (id: string) => void
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
}

interface YtEvent {
  data: number
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          width?: string
          height?: string
          videoId?: string
          playerVars?: Record<string, string | number>
          events?: { onReady?: () => void; onStateChange?: (event: YtEvent) => void }
        },
      ) => YtPlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve()
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiPromise
}

export function RecordPlayer() {
  const playerRef = useRef<YtPlayer | null>(null)
  const tracks = useRoomStore((state) => state.tracks)
  const currentId = useRoomStore((state) => state.currentId)
  const playing = useRoomStore((state) => state.playing)
  const open = useRoomStore((state) => state.playerOpen)
  const place = useRoomStore((state) => state.place)
  const setTracks = useRoomStore((state) => state.setTracks)
  const setCurrent = useRoomStore((state) => state.setCurrent)
  const setPlaying = useRoomStore((state) => state.setPlaying)
  const setPlayerOpen = useRoomStore((state) => state.setPlayerOpen)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const current = tracks.find((track) => track.videoId === currentId) ?? null

  const mountPlayer = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      playerRef.current?.destroy()
      playerRef.current = null
      return
    }
    void loadYouTubeApi().then(() => {
      if (!window.YT || playerRef.current) return
      playerRef.current = new window.YT.Player(node, {
        width: '100%',
        height: '100%',
        videoId: useRoomStore.getState().currentId ?? undefined,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onStateChange: (event) => {
            if (event.data === 1) useRoomStore.getState().setPlaying(true)
            if (event.data === 2) useRoomStore.getState().setPlaying(false)
            if (event.data === 0) {
              const state = useRoomStore.getState()
              const index = state.tracks.findIndex((track) => track.videoId === state.currentId)
              const next = state.tracks[index + 1]
              if (!next) {
                state.setPlaying(false)
                return
              }
              state.setCurrent(next.videoId)
              playerRef.current?.loadVideoById(next.videoId)
            }
          },
        },
      })
    })
  }, [])

  function play(videoId: string) {
    setCurrent(videoId)
    setPlaying(true)
    setPlayerOpen(true)
    playerRef.current?.loadVideoById(videoId)
    playerRef.current?.playVideo()
  }

  function toggle() {
    if (!currentId) {
      setPlayerOpen(true)
      return
    }
    if (playing) {
      playerRef.current?.pauseVideo()
      setPlaying(false)
      return
    }
    playerRef.current?.loadVideoById(currentId)
    playerRef.current?.playVideo()
    setPlaying(true)
  }

  async function addTrack(event: FormEvent) {
    event.preventDefault()
    const videoId = videoIdFromInput(draft)
    if (!videoId) {
      setMessage('Pegá un link de YouTube.')
      return
    }
    if (tracks.some((track) => track.videoId === videoId)) {
      play(videoId)
      setDraft('')
      return
    }
    const title = await videoTitle(videoId)
    const next = [...useRoomStore.getState().tracks, { videoId, title }]
    setTracks(next)
    await saveTracks(next)
    setDraft('')
    setMessage('')
    play(videoId)
  }

  async function remove(videoId: string) {
    const next = tracks.filter((track) => track.videoId !== videoId)
    setTracks(next)
    await saveTracks(next)
    if (currentId === videoId) {
      playerRef.current?.pauseVideo()
      setPlaying(false)
      setCurrent(next[0]?.videoId ?? null)
    }
  }

  return (
    <section className={`fixed right-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] ${place === 'paint' ? 'bottom-24' : 'bottom-3'}`}>
      <div className="overflow-hidden rounded-3xl border border-line bg-foam/95 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={`grid h-9 w-9 place-items-center rounded-full bg-ink text-[10px] text-foam ${playing ? 'vinyl-on' : ''}`}>
            ●
          </span>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPlayerOpen(!open)}>
            <p className="text-[11px] tracking-wide text-ink-soft uppercase">Tocadiscos</p>
            <p className="truncate text-sm">{current?.title ?? 'Sin música'}</p>
          </button>
          <button type="button" className="icon-action" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproducir'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </div>
        <div className="px-3">
          <div className={`overflow-hidden rounded-2xl bg-ink ${open ? 'aspect-video' : 'h-16'}`}>
            <YouTubeSlot onMount={mountPlayer} />
          </div>
          {open && (
            <>
          <form onSubmit={(event) => void addTrack(event)} className="mt-3 flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Link de YouTube"
              className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3 py-2 text-sm outline-none"
            />
            <button type="submit" className="studio-action">
              Poner
            </button>
          </form>
          {message && <p className="mt-2 text-xs text-coral">{message}</p>}
          <ul className="mt-3 max-h-36 space-y-1 overflow-auto pb-3">
            {tracks.map((track) => (
              <li key={track.videoId} className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-studio" onClick={() => play(track.videoId)}>
                  {track.videoId === currentId ? '● ' : ''}
                  {track.title}
                </button>
                <button type="button" className="text-ink-soft" aria-label={`Quitar ${track.title}`} onClick={() => void remove(track.videoId)}>
                  <X size={14} />
                </button>
              </li>
            ))}
            {tracks.length === 0 && <li className="pb-2 text-xs text-ink-soft">La música queda de fondo mientras pinta o juega.</li>}
          </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

const YouTubeSlot = memo(function YouTubeSlot({ onMount }: { onMount: (node: HTMLDivElement | null) => void }) {
  return <div ref={onMount} className="h-full w-full" />
})
